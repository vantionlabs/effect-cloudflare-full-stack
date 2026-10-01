/**
 * The planning view for the caller's organization: facts read with SQL (jobs with their customer's terms, invoices,
 * sent quotes, expenses), the forecast computed by `planCash`. A read model over `sales`' tables — read, never
 * imported, so slices still compose only through `shared`.
 */
import { Db } from "@ea/database/Database"
import { planCash } from "@ea/modules/reporting/domain/Planning"
import { PAYMENT_TERMS_DAYS } from "@ea/modules/shared/domain/Money"
import { Effect } from "effect"

export const GetPlanning = Effect.gen(function*() {
  const db = yield* Db
  const today = new Date().toISOString().slice(0, 10)
  const inputs = yield* db.scopedForOrg((sql, orgId) =>
    Effect.gen(function*() {
      const invoices = yield* sql<{ amount_cents: number; due_on: string }>`
        select amount_cents, to_char(due_on, 'YYYY-MM-DD') as due_on from invoices
         where organization_id = ${orgId} and status = 'open'
      `
      // Each job's terms: its customer's, matched by the quote's email, else the default — as `InvoiceJob` applies.
      const jobs = yield* sql<{ status: string; value_cents: number; accepted_on: string; terms_days: number }>`
        select j.status, j.value_cents, to_char(j.accepted_at at time zone 'UTC', 'YYYY-MM-DD') as accepted_on,
               coalesce(t.terms_days, ${PAYMENT_TERMS_DAYS}::integer) as terms_days
          from jobs j
          join quotes q on q.id = j.quote_id and q.organization_id = ${orgId}
          left join customer_terms t
            on t.organization_id = ${orgId} and t.customer_email = lower(q.customer_email)
         where j.organization_id = ${orgId} and j.status in ('open', 'done')
      `
      const quotes = yield* sql<{ total_cents: number }>`
        select total_cents from quotes where organization_id = ${orgId} and status = 'sent'
      `
      const expenses = yield* sql<
        { amount_cents: number; starts_on: string; repeat: "once" | "monthly"; stopped_on: string | null }
      >`
        select amount_cents, to_char(starts_on, 'YYYY-MM-DD') as starts_on, repeat,
               to_char(stopped_on, 'YYYY-MM-DD') as stopped_on
          from expenses where organization_id = ${orgId}
      `
      const [terms] = yield* sql<{ count: number }>`
        select count(*)::integer as count from customer_terms
         where organization_id = ${orgId} and terms_days <> ${PAYMENT_TERMS_DAYS}::integer
      `
      return {
        openInvoices: invoices.map((row) => ({ amountCents: row.amount_cents, dueOn: row.due_on })),
        doneJobs: jobs.filter((row) => row.status === "done").map((row) => ({
          valueCents: row.value_cents,
          termsDays: row.terms_days
        })),
        openJobs: jobs.filter((row) => row.status === "open").map((row) => ({
          valueCents: row.value_cents,
          acceptedOn: row.accepted_on,
          termsDays: row.terms_days
        })),
        sentQuotes: quotes.map((row) => ({ totalCents: row.total_cents })),
        expenses: expenses.map((row) => ({
          amountCents: row.amount_cents,
          startsOn: row.starts_on,
          repeat: row.repeat,
          stoppedOn: row.stopped_on
        })),
        customersWithOwnTerms: terms?.count ?? 0
      }
    })
  )
  return planCash(today, inputs)
})
