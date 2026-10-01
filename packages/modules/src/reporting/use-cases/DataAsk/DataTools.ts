/**
 * The read-only tools the data assistant may call. Three, each answering a whole question with figures the model
 * can quote — including SHARES, precomputed here, because `ungroundedFigures` refuses any number the model
 * calculated itself.
 *
 * Not text-to-SQL, deliberately: the model chooses a tool and a period, never a query. So it can neither read
 * another tenant's rows nor write anything, and every figure it can see is one these functions computed.
 *
 * Built per request (`dataToolkitFor`), closing over the request's database connection and tenant — the same
 * reason the documentation assistant's toolkit is: the model picks parameters, never whose data is read.
 */
import { Db } from "@ea/database/Database"
import type { CurrentOrg } from "@ea/domain/Identity"
import { resolveUsagePeriod } from "@ea/modules/shared/use-cases/Usage"
import { Effect, Schema } from "effect"
import { Tool, Toolkit } from "effect/ai"
import type { SqlClient } from "effect/sql"
import { ComputeWeeklyKpis } from "../WeeklyReport/ComputeWeeklyKpis.ts"

const Period = {
  from: Schema.optional(Schema.String).annotate({
    description: "First day, YYYY-MM-DD (UTC). Defaults to this month."
  }),
  to: Schema.optional(Schema.String).annotate({ description: "Day AFTER the last day, YYYY-MM-DD. Exclusive." })
}

export const ActivityFigures = Tool.make("activity_figures", {
  description: "Documents received, decisions made by outcome (with each outcome's share in percent), decisions " +
    "waiting for review right now, and model tokens by model, for a period.",
  parameters: Schema.Struct(Period),
  success: Schema.Unknown
})

export const QuoteFigures = Tool.make("quote_figures", {
  description: "Quotes created in a period, by status (draft, approved, sent, discarded): how many, and their total " +
    "value in euros including VAT.",
  parameters: Schema.Struct(Period),
  success: Schema.Unknown
})

export const ListQuotesTool = Tool.make("list_quotes", {
  description: "The most recent quotes, newest first: customer, status, total in euros including VAT, and the day it " +
    "was created. Optionally only one status.",
  parameters: Schema.Struct({
    status: Schema.optional(Schema.Literals(["draft", "approved", "sent", "discarded"])),
    limit: Schema.optional(Schema.Int).annotate({ description: "At most 20." })
  }),
  success: Schema.Unknown
})

export const DataToolkit = Toolkit.make(ActivityFigures, QuoteFigures, ListQuotesTool)

/** Euros as a two-decimal string from integer cents — a figure the model can quote exactly. */
const euros = (cents: number): string => (cents / 100).toFixed(2)
const share = (part: number, whole: number): number => whole === 0 ? 0 : Math.round((part / whole) * 100)

/** An invalid or absent period becomes this month; the tool says which period it used, so the model can say it. */
const periodOf = (input: { readonly from?: string | undefined; readonly to?: string | undefined }) =>
  Effect.catch(resolveUsagePeriod(input, new Date()), () => resolveUsagePeriod({}, new Date()))

export const dataToolkitFor = DataToolkit.toLayer(
  Effect.gen(function*() {
    const context = yield* Effect.context<Db | SqlClient.SqlClient | CurrentOrg>()
    const db = yield* Db
    return {
      activity_figures: (input) =>
        Effect.gen(function*() {
          const period = yield* periodOf(input)
          const k = yield* ComputeWeeklyKpis(period)
          const d = k.decisions
          return {
            period,
            documents_received: k.documentsReceived,
            decisions: {
              total: d.total,
              auto_approved: d.autoApproved,
              auto_approved_percent: share(d.autoApproved, d.total),
              sent_for_approval: d.routedForApproval,
              sent_for_approval_percent: share(d.routedForApproval, d.total),
              needed_a_person: d.needsHuman,
              needed_a_person_percent: share(d.needsHuman, d.total),
              rejected: d.rejected,
              rejected_percent: share(d.rejected, d.total)
            },
            waiting_for_review_now: k.pendingReview,
            model_tokens: k.tokens
          }
        }).pipe(Effect.provide(context), Effect.orDie),
      quote_figures: (input) =>
        Effect.gen(function*() {
          const period = yield* periodOf(input)
          const rows = yield* db.scopedForOrg((sql, orgId) =>
            sql<{ status: string; n: string | number; cents: string | number | null }>`
              select status, count(*) as n, sum(total_cents) as cents from quotes
               where organization_id = ${orgId}
                 and created_at >= (${period.from}::date::timestamp at time zone 'UTC')
                 and created_at <  (${period.to}::date::timestamp at time zone 'UTC')
               group by status
            `
          )
          const byStatus = Object.fromEntries(
            ["draft", "approved", "sent", "discarded"].map((status) => {
              const row = rows.find((r) => r.status === status)
              return [status, { count: Number(row?.n ?? 0), value_eur: euros(Number(row?.cents ?? 0)) }]
            })
          )
          return { period, quotes_by_status: byStatus, total_count: rows.reduce((s, r) => s + Number(r.n), 0) }
        }).pipe(Effect.provide(context), Effect.orDie),
      list_quotes: (input) =>
        Effect.gen(function*() {
          const limit = Math.min(Math.max(input.limit ?? 10, 1), 20)
          const rows = yield* db.scopedForOrg((sql, orgId) =>
            sql<{ customer_name: string | null; status: string; total_cents: number; created_at: Date }>`
              select customer_name, status, total_cents, created_at from quotes
               where organization_id = ${orgId}
                 and (${input.status ?? null}::text is null or status = ${input.status ?? null})
               order by created_at desc
               limit ${limit}
            `
          )
          return {
            quotes: rows.map((row) => ({
              customer: row.customer_name ?? "unknown",
              status: row.status,
              total_eur: euros(row.total_cents),
              created_on: row.created_at.toISOString().slice(0, 10)
            }))
          }
        }).pipe(Effect.provide(context), Effect.orDie)
    }
  })
)
