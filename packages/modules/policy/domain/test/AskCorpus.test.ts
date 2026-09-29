/**
 * The agent loop, driven by a scripted model. No network, no key, no database.
 *
 * What is worth testing here is **not** whether the model gives good answers — that is an eval, and it needs
 * a real model. It is the loop's own behaviour, which is where the expensive mistakes live: an unbounded loop
 * is an unbounded bill, and a tenant the model can influence is a cross-tenant read.
 */
import { AgentModel } from "@ea/modules/policy/domain/Ask"
import { AskCorpus, AskToolkit, AskToolkitLive } from "@ea/modules/policy/use-cases/Ask"
import { CurrentOrg, OrgId } from "@ea/modules/shared/domain/Identity"
import { PolicySearch, type Retrieval } from "@ea/modules/shared/domain/Retrieval"
import { Effect, Layer, Stream } from "effect"
import { LanguageModel } from "effect/ai"
import { describe, expect, it } from "vitest"

const ORG = OrgId.make("ask_org")

/** Records what the tool was asked for, so the test can assert on the tenant rather than trust it. */
const recordingSearch = () => {
  const queries: Array<string> = []
  let searchedOrg: string | null = null
  const layer = Layer.succeed(PolicySearch)({
    search: (input) =>
      Effect.flatMap(CurrentOrg, (orgId) =>
        Effect.sync(() => {
          queries.push(input.query)
          searchedOrg = orgId
          return {
            mode: "hybrid",
            chunks: [{
              chunk_id: "c1",
              document_id: "d1",
              heading: "Artikel 4 Goedgekeurde leveranciers",
              clause_ref: "Artikel 4",
              content: "Een factuur van een leverancier die niet op de lijst staat wordt doorgestuurd.",
              score: 1,
              semantic_rank: 1,
              lexical_rank: 1
            }]
          } as unknown as Retrieval
        }))
  })
  return { queries, layer, org: () => searchedOrg }
}

/**
 * A model that calls the tool `toolCalls` times and then answers.
 *
 * Counts its own invocations, because the property under test is how many times the LOOP called the model —
 * and asking the loop to report that would be the thing under test vouching for itself.
 */
const scripted = (options: { readonly toolCalls: number; readonly answer: string }) => {
  const calls = { model: 0 }
  // Provided under `AgentModel`, the tag `AskCorpus` actually requires — see `AgentModel.ts`. The test names
  // the same requirement production does, so a composition root that provided only the decide pipeline's
  // model would fail here too rather than only in the Worker.
  const layer = Layer.effect(AgentModel)(
    LanguageModel.make({
      generateText: () =>
        Effect.sync(() => {
          calls.model++
          if (calls.model <= options.toolCalls) {
            return [{
              type: "tool-call" as const,
              id: `call_${calls.model}`,
              name: "search_policy",
              params: { query: `zoekterm ${calls.model}` }
            }]
          }
          return [{ type: "text" as const, text: options.answer }]
        }),
      streamText: () => Stream.die(new Error("not used"))
    })
  )
  return { calls, layer }
}

const run = (model: Layer.Layer<AgentModel>, search: Layer.Layer<PolicySearch>) =>
  Effect.runPromise(
    AskCorpus("Mag ik een factuur van een onbekende leverancier goedkeuren?").pipe(
      // One provide: `AskToolkitLive` requires `PolicySearch` and `CurrentOrg`, so this is
      // `provideMerge` rather than a second chained provide (`multipleEffectProvide`).
      Effect.provide(
        AskToolkitLive.pipe(
          Layer.provideMerge(Layer.mergeAll(model, search, Layer.succeed(CurrentOrg)(ORG)))
        )
      )
    ) as Effect.Effect<{ answer: string; steps: number; truncated: boolean }, never, never>
  )

describe("the loop", () => {
  it("searches, then answers", async () => {
    const search = recordingSearch()
    const model = scripted({ toolCalls: 1, answer: "Nee — Artikel 4 stuurt die factuur naar de inkoopafdeling." })
    const result = await run(model.layer, search.layer)

    expect(result.truncated).toBe(false)
    expect(result.answer).toContain("Artikel 4")
    expect(search.queries).toEqual(["zoekterm 1"])
    // Two model calls: one that asked for the tool, one that answered with its result.
    expect(model.calls.model).toBe(2)
    expect(result.steps).toBe(2)
  })

  it("answers without searching, when it chooses to", async () => {
    // Not encouraged by the prompt, but the loop must not require a tool call — a model that already has the
    // answer in context should be able to say so rather than being forced into a paid round trip.
    const search = recordingSearch()
    const result = await run(scripted({ toolCalls: 0, answer: "Dat staat niet in het beleid." }).layer, search.layer)
    expect(result.steps).toBe(1)
    expect(search.queries).toEqual([])
  })

  it("STOPS at the bound, and says the answer is truncated", async () => {
    /*
     * The expensive failure. A model whose tool results never satisfy it will call forever, and every call is
     * paid for. `MAX_STEPS` is a hard stop rather than a safety net, and `truncated` exists so that hitting it
     * is visible: without it a bounded loop returns whatever text it happens to have and reads like a normal,
     * slightly worse answer.
     */
    const search = recordingSearch()
    const model = scripted({ toolCalls: 99, answer: "never reached" })
    const result = await run(model.layer, search.layer)

    expect(result.truncated).toBe(true)
    expect(result.answer).toBe("")
    // Bounded: 4 model calls and 4 searches, not 99.
    expect(model.calls.model).toBe(4)
    expect(search.queries.length).toBe(4)
  })
})

describe("the tenant", () => {
  it("is the one captured at layer build, not one the model could influence", async () => {
    /*
     * The security-relevant property. The MODEL chooses the query text, so the query is attacker-influenced
     * whenever a document is — and a document is attacker-controlled by definition here. The organization is
     * captured when `AskToolkitLive` is built and provided to the handler from that closure, so no prompt can
     * redirect the search. If this ever reads anything but `ORG`, the tool has started taking the tenant from
     * its arguments.
     */
    const search = recordingSearch()
    await run(scripted({ toolCalls: 1, answer: "ok" }).layer, search.layer)
    expect(search.org()).toBe(ORG)
  })

  it("offers exactly one tool, and it is read-only", async () => {
    // The whole safety argument: the agent's blast radius is the tool list. Retrieval and nothing else — no
    // approve, no execute, no write. A second tool here is a decision someone has to defend.
    expect(Object.keys(AskToolkit.tools)).toEqual(["search_policy"])
  })
})
