/**
 * The ordering that makes `AskInConversation` safe: answer first, record second — and **a refusal is
 * recorded and then re-raised.**
 *
 * That last property is the one worth a test. Recording a refusal is easy to write as "return it as a turn",
 * which compiles, reads well, and silently converts the product's refusal into a successful-looking answer
 * with no answer in it. `Serve.ts` and `AskRpcLive.ts` both record the same class of mistake being made and
 * caught; this asserts both halves at once, which is the only way to notice that one of them was dropped.
 *
 * The scripted model and the fake search are deliberately minimal copies of the ones in `AskCorpus.test.ts`
 * rather than a shared helper: what is under test here is the composition, so the pieces it composes should
 * be as dumb as possible, and a shared fixture that grew a feature for the other test would quietly change
 * what this one means.
 */
import { CurrentOrg, OrgId } from "@ea/domain/Identity"
import { AgentModel } from "@ea/modules/policy/domain/Ask"
import { AssistantConversations, type AssistantTurn } from "@ea/modules/policy/domain/Assistant"
import { AskToolkitLive } from "@ea/modules/policy/use-cases/Ask"
import { AskInConversation } from "@ea/modules/policy/use-cases/Assistant"
import { PolicySearch, type Retrieval } from "@ea/modules/shared/domain/Retrieval"
import { Effect, Layer, Stream } from "effect"
import { LanguageModel } from "effect/ai"
import { describe, expect, it } from "vitest"

const ORG = OrgId.make("conv_org")
const CHUNK = {
  chunk_id: "c1",
  document_id: "d1",
  heading: "Artikel 4",
  clause_ref: "Artikel 4",
  content: "Een factuur van een leverancier die niet op de lijst staat wordt doorgestuurd.",
  score: 1,
  semantic_rank: 1,
  lexical_rank: 1
}

const search = Layer.succeed(PolicySearch)({
  search: () => Effect.succeed({ mode: "hybrid", chunks: [CHUNK] } as unknown as Retrieval)
})

/**
 * Searches once, then answers citing whatever the test tells it to cite.
 *
 * **The search is not optional**, and finding that out was worth the detour: an earlier version answered
 * immediately and every grounded case was refused with *"chunk c1 was never returned by a search for this
 * question"*. That is `ungroundedCitations` working exactly as designed — a citation must have been SERVED
 * for this question, not merely exist in the corpus — so a model that cites without searching is ungrounded
 * by definition. Keeping the tool call here is what makes the grounded cases actually grounded.
 */
const scripted = (
  answer: string,
  citations: ReadonlyArray<{ chunk_id: string; clause_ref: string | null; excerpt: string }>
) => {
  let calls = 0
  return Layer.effect(AgentModel)(
    LanguageModel.make({
      generateText: () =>
        Effect.sync(() => {
          calls++
          if (calls === 1) {
            return [{
              type: "tool-call" as const,
              id: "call_1",
              name: "search_policy",
              params: { query: "onbekende leverancier" }
            }]
          }
          // Then the loop asks twice: once for the prose that ends it, once for the JSON it decodes.
          return calls === 2
            ? [{ type: "text" as const, text: answer }]
            : [{ type: "text" as const, text: JSON.stringify({ citations, answer }) }]
        }),
      streamText: () => Stream.die(new Error("not used"))
    })
  )
}

/** Records every turn it is asked to store, so the test can assert what was written rather than trust it. */
const recordingConversations = () => {
  const recorded: Array<typeof AssistantTurn.Encoded> = []
  const layer = Layer.succeed(AssistantConversations)({
    history: () => Effect.succeed({ turns: [] }),
    record: (_id, turn) =>
      Effect.flatMap(CurrentOrg, () =>
        Effect.sync(() => {
          recorded.push(turn)
          return { turns: [...recorded] }
        }))
  })
  return { recorded, layer }
}

const QUESTION = "Mag ik een factuur van een onbekende leverancier goedkeuren?"

const run = (
  model: Layer.Layer<AgentModel>,
  conversations: Layer.Layer<AssistantConversations>
) =>
  AskInConversation("conv-1", QUESTION).pipe(
    Effect.provide(
      AskToolkitLive.pipe(
        Layer.provideMerge(
          Layer.mergeAll(model, search, conversations, Layer.succeed(CurrentOrg)(ORG))
        )
      )
    )
  )

describe("a grounded answer", () => {
  const grounded = () =>
    scripted("Artikel 4 stuurt dit door.", [{
      chunk_id: "c1",
      clause_ref: "Artikel 4",
      // Verbatim from the chunk, so rail 2 passes.
      excerpt: "Een factuur van een leverancier die niet op de lijst staat wordt doorgestuurd."
    }])

  it("records the answer with its citations", async () => {
    const conversations = recordingConversations()
    await Effect.runPromise(run(grounded(), conversations.layer) as Effect.Effect<unknown, never, never>)
    expect(conversations.recorded).toHaveLength(1)
    expect(conversations.recorded[0]!.answer).toBe("Artikel 4 stuurt dit door.")
    expect(conversations.recorded[0]!.citations).toEqual(["c1"])
    expect(conversations.recorded[0]!.refusedBecause).toBeUndefined()
  })

  it("returns the answer and the conversation containing it", async () => {
    const conversations = recordingConversations()
    const result = await Effect.runPromise(
      // `as unknown as`, matching `refusalOf` in AskCorpus.test.ts: the error channel is real here and a
      // direct cast would be claiming these three errors cannot happen rather than that the test ignores them.
      run(grounded(), conversations.layer) as unknown as Effect.Effect<
        { answer: { answer: string }; conversation: { turns: ReadonlyArray<unknown> } },
        never,
        never
      >
    )
    expect(result.answer.answer).toBe("Artikel 4 stuurt dit door.")
    expect(result.conversation.turns).toHaveLength(1)
  })
})

describe("a refusal", () => {
  /** Cites a chunk the search never returned, which is what `ungroundedCitations` refuses. */
  const ungrounded = () =>
    scripted("Artikel 99 staat dit toe.", [{
      chunk_id: "never-retrieved",
      clause_ref: "Artikel 99",
      excerpt: "iets dat nergens staat"
    }])

  it("is still raised as an error, not returned as an empty answer", async () => {
    // The half that is easy to lose. If this ever passes as a success, the chat surface has become the way
    // around the grounding rule.
    const conversations = recordingConversations()
    const failure = await Effect.runPromise(
      Effect.flip(run(ungrounded(), conversations.layer)) as unknown as Effect.Effect<
        { _tag: string },
        never,
        never
      >
    )
    expect(failure._tag).toBe("UngroundedAnswer")
  })

  it("is recorded as a turn, with a reason and no answer", async () => {
    // The other half: a conversation that dropped its refusals would read as though the corpus had
    // answered everything.
    const conversations = recordingConversations()
    await Effect.runPromise(
      Effect.flip(run(ungrounded(), conversations.layer)) as Effect.Effect<unknown, never, never>
    )
    expect(conversations.recorded).toHaveLength(1)
    expect(conversations.recorded[0]!.answer).toBeUndefined()
    expect(conversations.recorded[0]!.refusedBecause).toBeTruthy()
    expect(conversations.recorded[0]!.citations).toEqual([])
  })
})
