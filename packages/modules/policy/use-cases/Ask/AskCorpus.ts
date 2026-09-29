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
import { AgentModel } from "@ea/modules/policy/domain/Ask"
import { CurrentOrg } from "@ea/modules/shared/domain/Identity"
import { PolicySearch } from "@ea/modules/shared/domain/Retrieval"
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
  /** How many tool calls it took. Reported so a loop that always hits the bound is visible. */
  readonly steps: number
  /** True when the bound stopped it rather than the model finishing. The answer is then partial. */
  readonly truncated: boolean
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

    for (let step = 1; step <= MAX_STEPS; step++) {
      const response = yield* Effect.provideService(
        LanguageModel.generateText({ prompt, toolkit: AskToolkit }),
        LanguageModel.LanguageModel,
        model
      )
      prompt = Prompt.concat(prompt, Prompt.fromResponseParts(response.content))

      const calledATool = response.content.some((part) => part.type === "tool-call")
      if (!calledATool) {
        return {
          answer: response.text,
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
      steps: MAX_STEPS,
      truncated: true
    } satisfies AskResult
  })
