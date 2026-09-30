/**
 * An adapter that records what it would have done and does nothing.
 *
 * Ships in `server/` rather than a test folder for the same reason the scripted language model does:
 * `wrangler dev` with no credentials should run the whole pipeline end to end, including approval and
 * execution, so a contributor can watch a decision reach the queue and be acted on.
 *
 * It reports `providerIdempotent: true` and implements `lookup`, which is honest rather than convenient: a
 * dry run genuinely cannot act twice, and it genuinely can say what it did — it keeps its own record. A
 * real adapter that cannot make both claims may not be enabled with auto-approve armed (ADR-0013).
 */
import { Adapter, AdapterResponse, type AdapterService } from "@ea/modules/decision/domain/Execution"
import { Effect, Layer, Option } from "effect"

export const DryRunAdapter: Layer.Layer<Adapter> = Layer.sync(Adapter)(() => {
  /*
   * Per-layer, not module-scope.
   *
   * A module-scope Map on Workers is shared by every request in one isolate and by none in another, which
   * produces "it worked on my machine" nondeterminism. Scoping it to the layer means one per composition,
   * which for a dry run is the honest lifetime: it remembers within a run and claims nothing beyond it.
   */
  const acted = new Map<string, AdapterResponse>()

  return {
    name: "dry-run",
    providerIdempotent: true,
    execute: (request) =>
      Effect.sync(() => {
        const existing = acted.get(request.idempotencyKey)
        if (existing !== undefined) return existing
        const response = new AdapterResponse({
          reference: `dry-run:${request.idempotencyKey}`,
          detail: { action: request.action, decisionId: request.decisionId, payload: request.payload }
        })
        acted.set(request.idempotencyKey, response)
        return response
      }),
    lookup: (idempotencyKey) => Effect.succeed(Option.fromNullishOr(acted.get(idempotencyKey)))
  } satisfies AdapterService
})
