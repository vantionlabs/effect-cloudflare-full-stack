/**
 * The decide pipeline as a plain composition — the orchestration that runs OUTSIDE `workerd`.
 *
 * `Extract → Retrieve → Decide → Settle`, in order, with the short circuit first. The logic is
 * `DecideSteps.ts`; this file only says the order, which is all an orchestrator should say.
 *
 * ## Why this exists alongside the Cloudflare one
 *
 * Production runs the same steps inside a `WorkflowEntrypoint` (ADR-0024), where the platform memoises each
 * completed step. This composition exists because **the pipeline has to stay runnable in Node**:
 * `evals/Decisions.ts` scores it against testcontainers Postgres and `DecideDocument.test.ts` drives it
 * there, and a pipeline reachable only through a `WorkflowEntrypoint` would take the only measurement of
 * decision quality with it.
 *
 * ## What it deliberately does NOT have
 *
 * **A memo.** This used to be an `effect/workflow` workflow over a hand-written 298-line Postgres engine
 * (`WorkflowEnginePg`, now deleted — ADR-0003's risk R7), whose whole job was to remember completed
 * activities so a late failure did not re-pay for the extraction. That property is the platform's now, and
 * it is proven where it actually applies: `apps/worker/test/DecideWorkflow.test.ts` runs the real
 * orchestration in `workerd` and asserts the expensive steps run once while the failing step retries.
 *
 * Nothing is lost here that this composition needed. A caller in Node runs the pipeline once; the guarantee
 * that *matters* against a redelivery is the short circuit, which is ours and is stronger than a memo —
 * `existingDecision` returns before any step runs, where a memo would replay each one. The narrow case that
 * went with the engine is a failure PART WAY through a Node run, which now re-extracts on the next attempt.
 * That is a test-harness concern rather than a production one, and it is stated rather than hidden.
 */
import { Effect } from "effect"
import type { DecidePayloadValue } from "./DecideContract.ts"
import { decideStep, existingDecision, extractStep, retrieveStep, settleDecision } from "./DecideSteps.ts"

export const DecideDocument = (payload: DecidePayloadValue) =>
  Effect.gen(function*() {
    const startedAt = yield* Effect.clockWith((clock) => clock.currentTimeMillis)

    /*
     * The short circuit, first and outside everything.
     *
     * Cheaper than any memo and strictly earlier: a memo saves re-running a step, this saves entering the
     * pipeline. It is also the guarantee that survived the engine's deletion, which is why the test named
     * "still refuses to decide twice if the workflow memo is gone" is now the headline rather than a backup.
     */
    const existing = yield* existingDecision(payload)
    if (existing !== undefined) return existing

    const extraction = yield* extractStep(payload)
    const retrieval = yield* retrieveStep(extraction.retrievalQuery)
    const proposal = yield* decideStep({ fields: extraction.fields, chunks: retrieval.chunks })

    return yield* settleDecision({ payload, extraction, retrieval, proposal, startedAt })
  })
