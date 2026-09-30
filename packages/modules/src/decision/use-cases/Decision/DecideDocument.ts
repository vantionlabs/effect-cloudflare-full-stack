/**
 * The decide pipeline as an `effect/workflow` workflow — the orchestration that runs OUTSIDE `workerd`.
 *
 * `Extract → Retrieve → Decide`, then the rails and the write. The logic lives in `DecideSteps.ts`; this
 * file only says what is memoised and in what order, which is exactly what an orchestrator should be.
 *
 * **This is no longer the only orchestrator.** Production runs the same steps inside a Cloudflare
 * `WorkflowEntrypoint` (ADR-0024), whose memo is the platform's rather than ours. This composition survives
 * because the pipeline has to stay runnable in Node: `evals/Decisions.ts` scores it against testcontainers
 * Postgres and `DecideDocument.test.ts` drives it there, and a pipeline reachable only through a
 * `WorkflowEntrypoint` would take the only measurement of decision quality with it.
 *
 * So the two differ in one dimension only — who remembers a completed step — and the four things that decide
 * whether the product is correct (the short circuit, the step order, the rails, the write) are shared code.
 */
import { ProposedDecision } from "@ea/modules/decision/domain/Decision"
import { Retrieval } from "@ea/modules/shared/domain/Retrieval"
import { Effect, Schema } from "effect"
import { Activity, Workflow } from "effect/workflow"
import { decideKey, DecidePayload, DecideResult } from "./DecideContract.ts"
import {
  decideStep,
  existingDecision,
  ExtractOutput,
  extractStep,
  retrieveStep,
  settleDecision
} from "./DecideSteps.ts"

export const DecideDocumentWorkflow = Workflow.make("DecideDocument", {
  payload: DecidePayload,
  success: DecideResult,
  error: Schema.Never,
  // The execution id derives from the work, so the memo and the row's decide_key agree by construction.
  idempotencyKey: (payload) => decideKey(payload.documentId, payload.vertical)
})

export const DecideDocumentLayer = DecideDocumentWorkflow.toLayer(
  Effect.fnUntraced(function*(payload) {
    const startedAt = yield* Effect.clockWith((clock) => clock.currentTimeMillis)

    const existing = yield* existingDecision(payload)
    if (existing !== undefined) return existing

    // Each `Activity.make` name is the memo key, so a redelivered message replays every completed step
    // from Postgres instead of paying for it again.
    const extraction = yield* Activity.make({
      name: "Extract",
      success: ExtractOutput,
      execute: extractStep(payload)
    })

    const retrieval = yield* Activity.make({
      name: "Retrieve",
      success: Retrieval,
      execute: retrieveStep(extraction.retrievalQuery)
    })

    const proposal = yield* Activity.make({
      name: "Decide",
      success: ProposedDecision,
      execute: decideStep({ fields: extraction.fields, chunks: retrieval.chunks })
    })

    return yield* settleDecision({ payload, extraction, retrieval, proposal, startedAt })
  })
)
