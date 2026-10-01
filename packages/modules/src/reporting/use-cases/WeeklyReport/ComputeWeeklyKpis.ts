/**
 * One organization's figures for a week. Tenant-scoped: every statement filters `organization_id` through
 * `Db.scopedForOrg`, which `scripts/boundaries.ts` checks.
 *
 * Read with SQL over the tables that hold the facts, not through the owning slices' code: a report is a read model,
 * and importing `decision` or `intake` use cases here would break the rule that slices compose only through
 * `shared`. The tables are the shared contract a reader may depend on.
 */
import { Db } from "@ea/database/Database"
import type { WeeklyKpis, WeekPeriod } from "@ea/modules/reporting/domain/WeeklyReport"
import { Effect } from "effect"

/** `count(*)` and `sum` arrive as strings for bigint; these are far inside `Number.MAX_SAFE_INTEGER`. */
const toNumber = (value: string | number | null): number => value === null ? 0 : Number(value)

export const ComputeWeeklyKpis = (period: WeekPeriod) =>
  Effect.gen(function*() {
    const db = yield* Db
    return yield* db.scopedForOrg((sql, orgId) =>
      Effect.gen(function*() {
        // Day boundaries pinned to UTC midnight, as `GetUsage` does, so the week does not move with the session.
        const from = sql`(${period.from}::date::timestamp at time zone 'UTC')`
        const to = sql`(${period.to}::date::timestamp at time zone 'UTC')`

        const [received] = yield* sql<{ n: string | number }>`
          select count(*) as n from intakes
           where organization_id = ${orgId} and received_at >= ${from} and received_at < ${to}
        `
        // The outcome as RAILED and stored — what the system decided, before any person overrode it.
        const outcomes = yield* sql<{ outcome: string; n: string | number }>`
          select outcome, count(*) as n from decisions
           where organization_id = ${orgId} and decided_at >= ${from} and decided_at < ${to}
           group by outcome
        `
        const [pending] = yield* sql<{ n: string | number }>`
          select count(*) as n from decisions where organization_id = ${orgId} and status = 'pending_review'
        `
        const tokens = yield* sql<{ model: string; meter: string; quantity: string | number }>`
          select model, meter, sum(quantity) as quantity from usage_records
           where organization_id = ${orgId} and model is not null
             and recorded_at >= ${from} and recorded_at < ${to}
           group by model, meter
        `

        const byOutcome = new Map(outcomes.map((row) => [row.outcome, toNumber(row.n)]))
        const models = [...new Set(tokens.map((row) => row.model))].sort()
        const tokensOf = (model: string, meter: string) =>
          toNumber(tokens.find((row) => row.model === model && row.meter === meter)?.quantity ?? null)

        return {
          period,
          documentsReceived: toNumber(received?.n ?? null),
          decisions: {
            total: outcomes.reduce((sum, row) => sum + toNumber(row.n), 0),
            autoApproved: byOutcome.get("auto_approve") ?? 0,
            routedForApproval: byOutcome.get("route_for_approval") ?? 0,
            rejected: byOutcome.get("reject") ?? 0,
            needsHuman: byOutcome.get("needs_human") ?? 0
          },
          pendingReview: toNumber(pending?.n ?? null),
          tokens: models.map((model) => ({
            model,
            input: tokensOf(model, "model.input_tokens"),
            output: tokensOf(model, "model.output_tokens")
          }))
        } satisfies WeeklyKpis
      })
    )
  })
