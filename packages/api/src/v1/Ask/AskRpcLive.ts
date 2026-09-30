/**
 * The agent's transport edge.
 *
 * Two things happen here that do not happen in any other handler, and both are deliberate.
 *
 * **It asks for a different model by a different name.** `AskCorpus` requires `AgentModel`, not
 * `LanguageModel` — the decide pipeline uses the Workers AI binding and never needs tools, while the agent
 * needs tool calling. Two layers under one tag would mean the last one wins and the loser fails silently, so
 * they are two tags. Which adapter satisfies `AgentModel` is the composition root's business, and `dep:check`
 * caught the first version of this file naming one directly.
 *
 * **It builds the toolkit per request.** `AskToolkitLive` captures the tenant at layer build so that no prompt
 * can redirect which corpus is searched. A memoised toolkit would capture one organization and serve it to
 * everybody — the worst possible version of this bug, because it would work correctly in a single-tenant test.
 */
import { AskRpcs } from "@ea/modules/policy/domain/Ask"
import { AskCorpus, AskToolkitLive } from "@ea/modules/policy/use-cases/Ask"
import { PolicySearchLive } from "@ea/modules/policy/use-cases/Retrieval"
import { Effect, Layer } from "effect"
import { serveForTenant } from "../Serve.ts"

/**
 * The longest question accepted.
 *
 * A cap rather than trust: the question goes straight into a paid prompt, and an unbounded one is an
 * unbounded bill from a single request. Truncated rather than refused — a reviewer who pasted a paragraph
 * should get an answer about the first part of it, not an error.
 */
const MAX_QUESTION_LENGTH = 2000

export const AskRpcLive = AskRpcs.toLayer(
  Effect.succeed({
    "Ask.question": (payload: { readonly question: string }) =>
      serveForTenant(
        AskCorpus(payload.question.slice(0, MAX_QUESTION_LENGTH)).pipe(
          /*
           * One provide. `AskToolkitLive` requires `PolicySearch`, so this is `provideMerge` rather
           * than `Layer.mergeAll`: merge would leave that requirement unsatisfied. Chaining two
           * provides built `PolicySearchLive` against its own memo map, which the Effect language
           * service flags as `multipleEffectProvide`.
           */
          Effect.provide(AskToolkitLive.pipe(Layer.provideMerge(PolicySearchLive)))
        )
      ).pipe(
        /*
         * `catchTag("AiError")`, NOT `orDie` — and this is the second time that distinction has mattered here.
         *
         * `orDie` discards the WHOLE error channel, so `UngroundedAnswer` would have died with the provider
         * errors and become a 500: the refusal that exists to stop an unverifiable citation reaching a reviewer
         * would have been reported as a server fault. `Serve.ts` records the same mistake being made and caught
         * on the intake path.
         *
         * An `AiError` genuinely is a defect from a caller's point of view: the remedy for "the model was
         * unavailable" is to retry, which a 500 already says, and freezing a provider's failure shape into a
         * published contract would promise not to change something we do not control.
         */
        Effect.catchTag("AiError", Effect.die)
      )
  })
)
