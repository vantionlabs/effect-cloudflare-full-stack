/**
 * Workers Analytics Engine behind the `Telemetry` port.
 *
 * Chosen over a log line for one reason: these are **rates**, and a rate needs aggregation over time.
 * Analytics Engine is queryable with SQL, keeps high-cardinality data, and is created implicitly on first
 * write — no resource to provision, which is the same property that made Workers AI free to adopt.
 *
 * ## The datapoint shape, and why the mapping is written down
 *
 * `writeDataPoint` takes three parallel arrays and **their positions are the schema**. There are no field
 * names on the wire, so a query reads `blob1`, `double2`, `index1` — which means inserting a value in the
 * middle silently reinterprets every historical row. So: **append only, never reorder**, and the comment
 * beside each position is the only documentation a future query author will have.
 *
 * `indexes` takes at most one entry and is what sampling groups by, so it holds `outcome` — the dimension
 * every question starts from.
 */
import type { DecisionObservation, TelemetryService } from "@ea/modules/decision/domain/Telemetry"
import { Telemetry } from "@ea/modules/decision/domain/Telemetry"
import { Effect, Layer } from "effect"

/** The slice of the binding used here. Structural, to keep Cloudflare's ambient types out of `modules`. */
export interface AnalyticsDatasetApi {
  readonly writeDataPoint: (point: {
    readonly blobs?: ReadonlyArray<string> | undefined
    readonly doubles?: ReadonlyArray<number> | undefined
    readonly indexes?: ReadonlyArray<string> | undefined
  }) => void
}

/** Position-for-position, append only. A reorder rewrites the meaning of every row already stored. */
const toDataPoint = (observation: DecisionObservation) => ({
  indexes: [observation.outcome],
  blobs: [
    observation.vertical, // blob1
    observation.outcome, // blob2  (also in indexes; duplicated so a query need not join on the index)
    observation.retrievalMode, // blob3
    // blob4: rail CATEGORIES, comma-joined. A rate per rail is `LIKE '%amount%'`, which is coarse but
    // needs no second dataset — and the categories are a closed set, so no value contains a comma.
    observation.railsFired.join(",")
  ],
  doubles: [
    observation.grounded ? 1 : 0, // double1 — sum/count is groundedRate
    observation.citations, // double2 — zero means unauditable, whatever the outcome says
    observation.inputTokens ?? 0, // double3
    observation.outputTokens ?? 0, // double4
    observation.durationMillis, // double5
    observation.replayed ? 1 : 0 // double6 — exclude these from every rate
  ]
})

export const TelemetryAnalytics = (dataset: AnalyticsDatasetApi): Layer.Layer<Telemetry> =>
  Layer.succeed(Telemetry)(
    {
      decision: (observation) =>
        /*
         * Never fails, and never blocks the decision.
         *
         * `writeDataPoint` is fire-and-forget by design, but a throw would still propagate — and a failed
         * metric write must not turn a made decision into a retried one. The decision is already committed
         * to Postgres by this point; losing its datapoint costs a gap in a graph.
         */
        Effect.ignore(Effect.sync(() => dataset.writeDataPoint(toDataPoint(observation))))
    } satisfies TelemetryService
  )
