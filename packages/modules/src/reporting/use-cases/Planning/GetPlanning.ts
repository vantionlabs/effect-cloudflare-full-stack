/**
 * The planning view for the caller's organization: facts read with SQL (jobs, invoices, sent quotes), the forecast
 * computed by `planCash`. A read model over `sales`' tables — read, never imported, so slices still compose only
 * through `shared`.
 */
import { Db } from "@ea/database/Database"
import { planCash } from "@ea/modules/reporting/domain/Planning"
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
      const jobs = yield* sql<{ status: string; value_cents: number; accepted_on: string }>`
        select status, value_cents, to_char(accepted_at at time zone 'UTC', 'YYYY-MM-DD') as accepted_on from jobs
         where organization_id = ${orgId} and status in ('open', 'done')
      `
      const quotes = yield* sql<{ total_cents: number }>`
        select total_cents from quotes where organization_id = ${orgId} and status = 'sent'
      `
      return {
        openInvoices: invoices.map((row) => ({ amountCents: row.amount_cents, dueOn: row.due_on })),
        doneJobs: jobs.filter((row) => row.status === "done").map((row) => ({ valueCents: row.value_cents })),
        openJobs: jobs.filter((row) => row.status === "open").map((row) => ({
          valueCents: row.value_cents,
          acceptedOn: row.accepted_on
        })),
        sentQuotes: quotes.map((row) => ({ totalCents: row.total_cents }))
      }
    })
  )
  return planCash(today, inputs)
})
