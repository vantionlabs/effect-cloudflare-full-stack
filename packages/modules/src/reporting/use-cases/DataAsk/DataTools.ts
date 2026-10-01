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
import { GetPlanning } from "../Planning/GetPlanning.ts"
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

export const PlanningFigures = Tool.make("planning_figures", {
  description: "Work in progress (open jobs; finished jobs not yet invoiced), open and overdue invoices, sent quotes " +
    "not yet answered (pipeline), and per week for the next 12 weeks the expected cash IN, cash OUT (recorded " +
    "expenses) and NET, in euros. The running net is the change in cash from today, not a bank balance. States its " +
    "assumptions (default payment terms, customers with their own terms, days to finish an open job).",
  /*
   * A real parameter, not an empty object. `Schema.Struct({})` compiled to a JSON schema with `anyOf`, which the
   * OpenAI-compatible client refuses ("Root JSON Schema must have type \"object\" and must not use \"anyOf\"") —
   * and it refused the WHOLE toolkit, so every Insights question failed, not just planning ones. Found by asking
   * the real model; the scripted model in the tests never validates tool schemas.
   */
  parameters: Schema.Struct({
    /*
     * A STRING the code parses, not an Int: the real model sent this as a string ("4"), and an Int parameter then
     * failed the whole call ("Invalid parameters … Expected number"). Anything unparseable falls back to 4 weeks.
     */
    horizon_weeks: Schema.optional(Schema.String).annotate({
      description: "How many weeks ahead to total, 1 to 12, e.g. 4 for \"the next month\". Defaults to 4."
    })
  }),
  success: Schema.Unknown
})

export const DataToolkit = Toolkit.make(ActivityFigures, QuoteFigures, ListQuotesTool, PlanningFigures)

/** Euros as a two-decimal string from integer cents — a figure the model can quote exactly. */
const euros = (cents: number): string => (cents / 100).toFixed(2)
const total = (
  weeks: ReadonlyArray<{ readonly total: number; readonly out: number; readonly net: number }>,
  field: "total" | "out" | "net"
): number => weeks.reduce((sum, week) => sum + week[field], 0)
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
      planning_figures: (input) =>
        Effect.map(GetPlanning, (plan) => {
          const requested = Number.parseInt(input.horizon_weeks ?? "4", 10)
          const horizon = Math.min(Math.max(Number.isFinite(requested) ? requested : 4, 1), plan.weeks.length)
          const sum = (amount: { readonly count: number; readonly cents: number }) => ({
            count: amount.count,
            value_eur: euros(amount.cents)
          })
          return {
            today: plan.today,
            assumptions: {
              default_payment_terms_days: plan.assumptions.paymentTermsDays,
              customers_with_their_own_terms: plan.assumptions.customersWithOwnTerms,
              open_job_assumed_finished_after_days: plan.assumptions.openJobDays
            },
            work_in_progress: {
              open_jobs: sum(plan.workInProgress.openJobs),
              finished_not_invoiced: sum(plan.workInProgress.doneNotInvoiced)
            },
            open_invoices: sum(plan.openInvoices),
            overdue_invoices: sum(plan.overdue),
            pipeline_sent_quotes: sum(plan.pipeline),
            per_week: plan.weeks.map((week) => ({
              week_starting: week.weekStart,
              cash_in_eur: euros(week.total),
              cash_out_eur: euros(week.out),
              net_eur: euros(week.net)
            })),
            horizon_weeks: horizon,
            expected_cash_in_over_horizon_eur: euros(total(plan.weeks.slice(0, horizon), "total")),
            expected_cash_out_over_horizon_eur: euros(total(plan.weeks.slice(0, horizon), "out")),
            net_change_over_horizon_eur: euros(total(plan.weeks.slice(0, horizon), "net")),
            expected_cash_in_next_12_weeks_eur: euros(total(plan.weeks, "total")),
            expected_cash_out_next_12_weeks_eur: euros(total(plan.weeks, "out")),
            net_change_next_12_weeks_eur: euros(total(plan.weeks, "net")),
            expected_later_eur: euros(plan.later)
          }
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
