/**
 * The usage report for the caller's organization over a period.
 *
 * Day boundaries are UTC midnight, written out (`::timestamp at time zone 'UTC'`) rather than left to a bare
 * `::date` comparison, which would resolve in the SESSION's time zone and move an invoice's edges with server
 * configuration.
 *
 * Summed in SQL rather than in code: the table grows by a few rows per document and per model call, and a month
 * of a busy organization is not something to ship across the wire to add up. Both queries are tenant-scoped
 * through `Db.scoped`, which is what `scripts/boundaries.ts` checks for every statement against `usage_records`.
 */
import { Db } from "@ea/database/Database"
import type { Meter } from "@ea/modules/shared/domain/Usage"
import { Effect } from "effect"

export interface UsagePeriod {
  /** Inclusive, `YYYY-MM-DD` UTC. */
  readonly from: string
  /** Exclusive, `YYYY-MM-DD` UTC. */
  readonly to: string
}

export interface UsageReport extends UsagePeriod {
  readonly totals: ReadonlyArray<{ readonly meter: Meter; readonly model: string | null; readonly quantity: number }>
  readonly daily: ReadonlyArray<{ readonly day: string; readonly meter: Meter; readonly quantity: number }>
}

/** `bigint` sums arrive as strings from the driver. Meter totals stay far inside `Number.MAX_SAFE_INTEGER`. */
const toNumber = (value: string | number): number => typeof value === "number" ? value : Number(value)

/** The current calendar month in UTC — the period an invoice covers, and the default. */
export const currentMonth = (now: Date): UsagePeriod => {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

export const GetUsage = (period: UsagePeriod) =>
  Effect.gen(function*() {
    const db = yield* Db
    return yield* db.scoped((sql, orgId) =>
      Effect.gen(function*() {
        const totals = yield* sql<{ meter: Meter; model: string | null; quantity: string | number }>`
          select meter, model, sum(quantity) as quantity
            from usage_records
           where organization_id = ${orgId}
             and recorded_at >= (${period.from}::date::timestamp at time zone 'UTC')
             and recorded_at <  (${period.to}::date::timestamp at time zone 'UTC')
           group by meter, model
           order by meter, model nulls first
        `
        const daily = yield* sql<{ day: string; meter: Meter; quantity: string | number }>`
          select to_char(date_trunc('day', recorded_at at time zone 'UTC'), 'YYYY-MM-DD') as day,
                 meter, sum(quantity) as quantity
            from usage_records
           where organization_id = ${orgId}
             and recorded_at >= (${period.from}::date::timestamp at time zone 'UTC')
             and recorded_at <  (${period.to}::date::timestamp at time zone 'UTC')
           group by 1, meter
           order by 1, meter
        `
        return {
          from: period.from,
          to: period.to,
          totals: totals.map((row) => ({ meter: row.meter, model: row.model, quantity: toNumber(row.quantity) })),
          daily: daily.map((row) => ({ day: row.day, meter: row.meter, quantity: toNumber(row.quantity) }))
        } satisfies UsageReport
      })
    )
  })
