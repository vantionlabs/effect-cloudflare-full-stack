/**
 * Reviewer Q&A over the policy corpus: an agent, with retrieval as its only tool.
 *
 * **Deliberately beside the decide path, never in it.** The entire argument for the decide pipeline is that
 * it is *not* a loop with unbounded authority: four named activities, a closed outcome enum, and four rails
 * behind an unconstructible brand. An agent that could reach `EmitExecute` would undo all of that, so this
 * imports no execution use case and `bun run dep:check` asserts exactly one `EmitExecute` call site
 * independently.
 *
 * What it is for: a reviewer looking at a routed decision asking "which clause covers a supplier that is not
 * on the approved list?" — a question the corpus can answer and the queue cannot.
 *
 * ## Three constraints, each for a reason this codebase has already paid for
 *
 * **It must cite, and an uncited answer is a failure.** The first real eval run produced 12 of 12
 * `needs_human` with zero citations — an unauditable refusal wearing caution as a disguise. Same lesson here:
 * an answer nobody can check is worse than no answer, because it reads as authoritative.
 *
 * **The loop is bounded.** `MAX_STEPS` is a hard stop, not a safety net. An unbounded agent loop on a paid
 * model is an unbounded invoice, and the failure mode is a model that calls the same tool forever because its
 * results never satisfy it.
 *
 * **It answers from retrieved clauses or it declines.** The corpus is the authority; the model's own
 * knowledge of Dutch procurement law is not, and must not leak into an answer a reviewer will act on.
 */
import { CurrentOrg } from "@ea/domain/Identity"
import { AgentModel } from "@ea/modules/policy/domain/Ask"
import { UngroundedAnswer } from "@ea/modules/policy/domain/Errors"
import { PolicySearch } from "@ea/modules/shared/domain/Retrieval"
import { containsVerbatim } from "@ea/modules/shared/domain/Verbatim"
import { Effect, Schema } from "effect"
import { LanguageModel, Prompt, Tool, Toolkit } from "effect/ai"

/**
 * The hard stop. Four is enough for "search, read, search again with better terms, answer".
 *
 * A bound rather than a timeout because the cost being controlled is model calls, not wall clock — and a
 * timeout would cut off mid-answer while still having paid for every call.
 */
const MAX_STEPS = 4

/** How many clauses one search returns. The decide path uses 8; a reviewer reads, so fewer and better. */
const SEARCH_LIMIT = 5

/**
 * A citation, in the same shape the decide path uses and for the same reason: a `chunk_id` to check against, and
 * a verbatim excerpt to check with.
 *
 * `chunk_id` rather than only `clause_ref`, because a clause reference is text the model can invent that looks
 * plausible, while a chunk id is an opaque value it can only have seen by calling the tool.
 */
export class AskCitation extends Schema.Class<AskCitation>("AskCitation")({
  chunk_id: Schema.String,
  clause_ref: Schema.NullOr(Schema.String),
  /** The part relied on, quoted. Checked with `containsVerbatim` against what the tool actually returned. */
  excerpt: Schema.String
}) {}

/**
 * The final answer, as an object rather than prose.
 *
 * **The loop used to end at `response.text`, and that was the hole.** The model was *told* to cite; nothing
 * checked that it had, or that what it cited existed. A structured final pass makes the citations addressable,
 * which is what makes them checkable — the same move the decide path makes with `ProposedDecision`.
 *
 * `citations` is declared BEFORE `answer`, which is not cosmetic: a model emits keys in schema order, so it
 * names the clauses it is relying on before it writes the prose that relies on them. That ordering accounted for
 * 25 of 66 grounding failures the other way round in the predecessor project — the measurement recorded in
 * ADR-0008.
 */
export class GroundedAnswer extends Schema.Class<GroundedAnswer>("GroundedAnswer")({
  citations: Schema.Array(AskCitation),
  answer: Schema.String
}) {}

/**
 * The one tool. Retrieval, and nothing else — no write, no execute, no database access of any kind.
 *
 * `Tool.make` rather than a free-form function so the parameter schema reaches the provider as a real JSON
 * schema: a tool whose arguments the model has to guess is a tool it calls wrongly.
 */
export const SearchPolicy = Tool.make("search_policy", {
  description: "Search the organisation's policy corpus and return the most relevant clauses, each with its clause " +
    "reference and verbatim text. Use it before answering, and search again with different words if the " +
    "first results do not settle the question.",
  parameters: Schema.Struct({
    query: Schema.String.annotate({
      description: "What to look for, in the language of the policy — Dutch for a Dutch corpus."
    })
  }),
  success: Schema.Struct({
    clauses: Schema.Array(Schema.Struct({
      chunk_id: Schema.String,
      clause_ref: Schema.NullOr(Schema.String),
      heading: Schema.NullOr(Schema.String),
      content: Schema.String
    })),
    /** Surfaced to the model on purpose: a lexical-only answer is weaker and it should say so. */
    retrieval_mode: Schema.String
  })
})

/** The toolkit, with the handler bound to the `PolicySearch` port. */
export const AskToolkit = Toolkit.make(SearchPolicy)

/*
 * The handlers must have `R = never` — a toolkit is handed to a provider, which cannot supply services at
 * call time. So `PolicySearch` and the **tenant** are captured when this layer is built, which means it has
 * to be built inside the request or message scope rather than in the memoised app graph. The same constraint
 * shapes `WorkflowEnginePg`, and for the same reason.
 *
 * Capturing the tenant is the security-relevant half: the model chooses the query text, and it must not be
 * able to influence *whose* corpus is searched. With the organization closed over at build time, a prompt
 * injection can ask for anything and still only ever read one tenant's policy.
 */
export const AskToolkitLive = AskToolkit.toLayer(
  Effect.gen(function*() {
    const policy = yield* PolicySearch
    const orgId = yield* CurrentOrg
    return {
      search_policy: ({ query }: { readonly query: string }) =>
        Effect.map(
          Effect.provideService(policy.search({ query, limit: SEARCH_LIMIT }), CurrentOrg, orgId),
          (retrieval) => ({
            clauses: retrieval.chunks.map((chunk) => ({
              chunk_id: chunk.chunk_id,
              clause_ref: chunk.clause_ref,
              heading: chunk.heading,
              content: chunk.content
            })),
            retrieval_mode: retrieval.mode
          })
        )
    }
  })
)

const SYSTEM = `You answer questions about an organisation's procurement policy for a human reviewer.

Rules:
- Search before you answer. Use the search_policy tool, and search again with different words if the first
  results do not settle the question.
- Answer ONLY from clauses the tool returned. Your own knowledge of procurement or of Dutch law is not the
  authority here — the corpus is.
- ALWAYS name the clauses you relied on, by their clause reference, and quote the part you relied on. An
  answer nobody can check is worse than no answer, because it reads as authoritative.
- If the corpus does not settle the question, say so and say what is missing. That is a correct answer.
- If the tool reports retrieval_mode other than "hybrid", say that the search was degraded, because the
  answer may be missing clauses that a full search would have found.`

export interface AskResult {
  readonly answer: string
  /** The clauses relied on, every one of them verified against what the tool actually returned. */
  readonly citations: ReadonlyArray<AskCitation>
  /** How many tool calls it took. Reported so a loop that always hits the bound is visible. */
  readonly steps: number
  /** True when the bound stopped it rather than the model finishing. The answer is then partial. */
  readonly truncated: boolean
}

/**
 * Every citation must name a chunk the tool returned, and quote it verbatim.
 *
 * **This is the chat surface's version of rails 1 and 2, and it exists because without it this endpoint is the
 * way around them.** The decide path refuses a decision whose excerpt is not verbatim in the cited chunk; an
 * agent that can put an unverified quote in front of the same reviewer undoes that, and does it in the surface
 * that reads most like a conversation and least like a claim.
 *
 * `containsVerbatim` is the SAME function the rails use and the console highlights with — whitespace-normalised
 * and case-folded, so a re-wrapped line still matches, while punctuation, digits and currency symbols must not
 * differ. Those are the things worth lying about.
 *
 * An answer with NO citations passes: "the corpus does not settle this" is a correct answer and the prompt asks
 * for it. What must not pass is a citation that cannot be checked.
 */
const ungroundedCitations = (
  citations: ReadonlyArray<AskCitation>,
  served: ReadonlyMap<string, string>
): ReadonlyArray<string> => {
  const reasons: Array<string> = []
  for (const citation of citations) {
    const content = served.get(citation.chunk_id)
    if (content === undefined) {
      reasons.push(
        `citation: chunk ${citation.chunk_id} was never returned by a search for this question` +
          (citation.clause_ref === null ? "" : ` (cited as ${citation.clause_ref})`)
      )
      continue
    }
    if (!containsVerbatim(citation.excerpt, content)) {
      reasons.push(`citation: excerpt is not verbatim in ${citation.clause_ref ?? citation.chunk_id}`)
    }
  }
  return reasons
}

/**
 * Runs the loop.
 *
 * `generateText` resolves the toolkit's handlers and returns the parts, but it does **not** loop — one round
 * per call. So the history is threaded back in and the loop continues while the model is still calling tools,
 * which is where `MAX_STEPS` bites.
 */
export const AskCorpus = (question: string) =>
  Effect.gen(function*() {
    /*
     * The agent's model, not the decide pipeline's — see `AgentModel.ts` for why they are separate tags.
     * Provided as `LanguageModel` for the duration of each call, so `generateText` finds it without the two
     * ever coexisting under one tag.
     */
    const model = yield* AgentModel

    let prompt = Prompt.make([
      { role: "system", content: SYSTEM },
      { role: "user", content: [{ type: "text", text: question }] }
    ])

    /*
     * What the tool actually returned, accumulated across every search: chunk id → content.
     *
     * Read from `response.toolResults` rather than recorded inside the toolkit, on purpose. The handlers are
     * built by the caller (they must have `R = never`), so a recorder there would be shared mutable state
     * reaching across a layer boundary — and the loop already has the parts in hand. This map is the ONLY
     * definition of "was retrieved for this question", which is what makes the check below meaningful.
     */
    const served = new Map<string, string>()

    for (let step = 1; step <= MAX_STEPS; step++) {
      const response = yield* Effect.provideService(
        LanguageModel.generateText({ prompt, toolkit: AskToolkit }),
        LanguageModel.LanguageModel,
        model
      )
      prompt = Prompt.concat(prompt, Prompt.fromResponseParts(response.content))

      for (const part of response.toolResults) {
        const result = part.result as { readonly clauses?: ReadonlyArray<{ chunk_id: string; content: string }> }
        for (const clause of result.clauses ?? []) served.set(clause.chunk_id, clause.content)
      }

      const calledATool = response.content.some((part) => part.type === "tool-call")
      if (!calledATool) {
        /*
         * The model has stopped searching and wants to answer. One more call, structured — this is where the
         * free-text answer used to be returned unchecked.
         *
         * The extra model call is the cost of the citations being addressable, and it is bounded: one, after a
         * loop that is already bounded at `MAX_STEPS`. Paying it on every question is cheaper than the failure
         * it prevents, which is an unverifiable quote shown to somebody deciding whether to pay an invoice.
         */
        const structured = yield* Effect.provideService(
          LanguageModel.generateObject({
            prompt: Prompt.concat(
              prompt,
              Prompt.make([{
                role: "user",
                content: [{
                  type: "text",
                  text: "Now give your final answer as an object. For every clause you relied on, include its " +
                    "chunk_id exactly as the tool returned it, its clause_ref, and the exact words you relied " +
                    "on as excerpt. If the corpus does not settle the question, return an empty citations " +
                    "array and say what is missing."
                }]
              }])
            ),
            schema: GroundedAnswer,
            objectName: "GroundedAnswer"
          }),
          LanguageModel.LanguageModel,
          model
        )

        const answer = structured.value as GroundedAnswer
        const reasons = ungroundedCitations(answer.citations, served)
        if (reasons.length > 0) return yield* Effect.fail(new UngroundedAnswer({ reasons }))

        return {
          answer: answer.answer,
          citations: answer.citations,
          steps: step,
          truncated: false
        } satisfies AskResult
      }
    }

    /*
     * The bound was reached, and that is REPORTED rather than silently returning whatever text exists.
     *
     * A loop that always hits its bound is a prompt problem or a retrieval problem, and it looks like a
     * slightly slow answer unless something says so.
     */
    return {
      answer: "",
      citations: [],
      steps: MAX_STEPS,
      truncated: true
    } satisfies AskResult
  })
