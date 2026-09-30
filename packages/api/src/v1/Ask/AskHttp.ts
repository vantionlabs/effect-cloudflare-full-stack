/**
 * The agent's HTTP edge, and it has to do the same two unusual things `AskRpcLive` does.
 *
 * **The toolkit is built per request.** `AskToolkitLive` captures the tenant at layer build, so that no prompt
 * can redirect which corpus is searched. A memoised toolkit would capture one organization and serve it to
 * everybody — the worst version of this bug, because it works perfectly in a single-tenant test.
 *
 * **The question is capped, not trusted.** It goes straight into a paid prompt, so an unbounded question is an
 * unbounded bill from one request. Truncated rather than refused, so somebody who pasted a paragraph gets an
 * answer about the start of it.
 *
 * Duplicating those two lines from `AskRpcLive` is the honest cost of two transports onto one use case. The
 * alternative — a shared wrapper — would hide that a second door exists, and the thing that must not drift is
 * the tenant capture, which is asserted by a test in `policy/domain/test/AskCorpus.test.ts` rather than by
 * being written once.
 */
import { UngroundedAnswerV1 } from "@ea/modules/policy/domain/Ask"
import { AskCorpus, AskToolkitLive } from "@ea/modules/policy/use-cases/Ask"
import { PolicySearchLive } from "@ea/modules/policy/use-cases/Retrieval"
import { Effect, Layer } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { ApiV1 } from "../ApiV1.ts"
import { serveForTenant } from "../Serve.ts"

const MAX_QUESTION_LENGTH = 2000

export const AskHttp = HttpApiBuilder.group(
  ApiV1,
  "ask",
  (handlers) =>
    handlers.handle("question", ({ payload }) =>
      serveForTenant(
        AskCorpus(payload.question.slice(0, MAX_QUESTION_LENGTH)).pipe(
          Effect.provide(AskToolkitLive.pipe(Layer.provideMerge(PolicySearchLive)))
        )
      ).pipe(
        /*
         * The provider's failure dies; the REFUSAL does not. `orDie` would have discarded both — the mistake
         * `Serve.ts` records making on the intake path, where a typed 415 became a crash.
         */
        Effect.catchTag("AiError", Effect.die),
        Effect.catchTag("UngroundedAnswer", (error) => Effect.fail(new UngroundedAnswerV1({ reasons: error.reasons })))
      ))
)
