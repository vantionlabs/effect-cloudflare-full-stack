/**
 * The steps after a quote is sent, each a person's action and each a compare-and-swap on status:
 * the customer's answer, finishing a job, invoicing it, and recording payment.
 *
 * Dates are UTC days — `(now() at time zone 'UTC')::date`, never the session's `current_date` — so an invoice's
 * due date does not move with server configuration.
 */
import { Db } from "@ea/database/Database"
import type { OrgId } from "@ea/domain/Identity"
import { CurrentUser } from "@ea/domain/Identity"
import { Ids } from "@ea/domain/Ids"
import {
  InvoiceAlreadyPaid,
  InvoiceNotFound,
  JobNotFound,
  JobNotInState,
  QuoteNotFound,
  QuoteNotInState
} from "@ea/modules/sales/domain/Errors"
import { Invoice, Job, JobId, type JobStatus } from "@ea/modules/sales/domain/Work"
import { Cents, PAYMENT_TERMS_DAYS } from "@ea/modules/shared/domain/Money"
import { Effect } from "effect"
import type { SqlClient, SqlError } from "effect/sql"
import { loadQuotes } from "../Quote/QuoteRows.ts"

interface JobRow {
  id: string
  quote_id: string
  customer_name: string | null
  status: JobStatus
  value_cents: number
  accepted_at: Date
  completed_at: Date | null
}

const toJob = (row: JobRow) =>
  new Job({
    id: JobId.make(row.id),
    quoteId: row.quote_id,
    customerName: row.customer_name,
    status: row.status,
    value: Cents.make(row.value_cents),
    acceptedAt: row.accepted_at.toISOString(),
    completedAt: row.completed_at === null ? null : row.completed_at.toISOString()
  })

interface InvoiceRow {
  id: string
  job_id: string
  customer_name: string | null
  amount_cents: number
  issued_on: string
  due_on: string
  status: "open" | "paid"
  paid_on: string | null
}

const toInvoice = (row: InvoiceRow) =>
  new Invoice({
    id: row.id,
    jobId: row.job_id,
    customerName: row.customer_name,
    amount: Cents.make(row.amount_cents),
    issuedOn: row.issued_on,
    dueOn: row.due_on,
    status: row.status,
    paidOn: row.paid_on
  })

const JOB_COLUMNS = "id, quote_id, customer_name, status, value_cents, accepted_at, completed_at"
// `to_char` so a date crosses as the plain `YYYY-MM-DD` the domain uses, not a Date at local midnight.
const INVOICE_COLUMNS = `id, job_id, customer_name, amount_cents, to_char(issued_on, 'YYYY-MM-DD') as issued_on,
  to_char(due_on, 'YYYY-MM-DD') as due_on, status, to_char(paid_on, 'YYYY-MM-DD') as paid_on`

const loadJob = (sql: SqlClient.SqlClient, orgId: OrgId, jobId: string) =>
  Effect.map(
    sql<JobRow>`select ${sql.literal(JOB_COLUMNS)} from jobs where organization_id = ${orgId} and id = ${jobId}`,
    (rows) => rows[0] === undefined ? undefined : toJob(rows[0])
  )

/** The customer's answer to a SENT quote. Accepting creates its job, in the same transaction. */
export const RespondToQuote = (quoteId: string, accepted: boolean) =>
  Effect.gen(function*() {
    const db = yield* Db
    const ids = yield* Ids
    const user = yield* CurrentUser
    const jobId = yield* ids.next
    return yield* db.scoped((sql, orgId) =>
      Effect.gen(function*() {
        const updated = yield* sql<{ customer_name: string | null; total_cents: number }>`
          update quotes set status = ${accepted ? "accepted" : "declined"}, responded_at = now()
           where organization_id = ${orgId} and id = ${quoteId} and status = 'sent'
          returning customer_name, total_cents
        `
        const quote = updated[0]
        if (quote === undefined) {
          const exists = yield* sql<
            { id: string }
          >`select id from quotes where organization_id = ${orgId} and id = ${quoteId}`
          return yield* (exists.length === 0
            ? new QuoteNotFound({ quoteId })
            : new QuoteNotInState({ quoteId, expected: "sent" }))
        }
        if (accepted) {
          yield* sql`
            insert into jobs (id, organization_id, quote_id, customer_name, status, value_cents, created_by)
            values (${jobId}, ${orgId}, ${quoteId}, ${quote.customer_name}, 'open', ${quote.total_cents}, ${user.userId})
          `
        }
        const [reloaded] = yield* loadQuotes(sql, orgId, [quoteId])
        return reloaded!
      })
    )
  })

export const ListJobs = Effect.flatMap(Db, (db) =>
  db.scoped((sql, orgId) =>
    Effect.map(
      sql<JobRow>`
        select ${sql.literal(JOB_COLUMNS)} from jobs where organization_id = ${orgId}
         order by (status = 'invoiced'), accepted_at desc limit 100
      `,
      (rows) => rows.map(toJob)
    )
  ))

export const ListInvoices = Effect.flatMap(Db, (db) =>
  db.scoped((sql, orgId) =>
    Effect.map(
      sql<InvoiceRow>`
        select ${sql.literal(INVOICE_COLUMNS)} from invoices where organization_id = ${orgId}
         order by (status = 'paid'), due_on limit 100
      `,
      (rows) => rows.map(toInvoice)
    )
  ))

/** Moves a job from `from` to `to`, or explains why it could not. */
const advanceJob = (
  jobId: string,
  from: JobStatus,
  to: JobStatus,
  onAdvance?: (sql: SqlClient.SqlClient, orgId: OrgId, job: JobRow) => Effect.Effect<void, SqlError.SqlError>
) =>
  Effect.flatMap(Db, (db) =>
    db.scoped((sql, orgId) =>
      Effect.gen(function*() {
        const updated = yield* sql<JobRow>`
          update jobs set status = ${to}, completed_at = case when ${to} = 'done' then now() else completed_at end
           where organization_id = ${orgId} and id = ${jobId} and status = ${from}
          returning ${sql.literal(JOB_COLUMNS)}
        `
        if (updated[0] === undefined) {
          return yield* ((yield* loadJob(sql, orgId, jobId)) === undefined
            ? new JobNotFound({ jobId })
            : new JobNotInState({ jobId }))
        }
        if (onAdvance !== undefined) yield* onAdvance(sql, orgId, updated[0])
        return (yield* loadJob(sql, orgId, jobId))!
      })
    ))

export const CompleteJob = (jobId: string) => advanceJob(jobId, "open", "done")

/**
 * Invoices a FINISHED job: issued today, for the job's value, due after THIS customer's payment terms — matched by
 * the quote's email — or the default terms when the customer has none.
 */
export const InvoiceJob = (jobId: string) =>
  Effect.gen(function*() {
    const ids = yield* Ids
    const invoiceId = yield* ids.next
    return yield* advanceJob(jobId, "done", "invoiced", (sql, orgId, job) =>
      sql`
        insert into invoices (id, organization_id, job_id, customer_name, amount_cents, issued_on, due_on, status)
        values (
          ${invoiceId}, ${orgId}, ${job.id}, ${job.customer_name}, ${job.value_cents},
          (now() at time zone 'UTC')::date,
          (now() at time zone 'UTC')::date + coalesce(
            (select t.terms_days from customer_terms t join quotes q on lower(q.customer_email) = t.customer_email
              where t.organization_id = ${orgId} and q.organization_id = ${orgId} and q.id = ${job.quote_id}),
            ${PAYMENT_TERMS_DAYS}::integer
          ),
          'open'
        )
      `.pipe(Effect.asVoid))
  })

/** Records that an invoice was paid today. */
export const RecordPayment = (invoiceId: string) =>
  Effect.flatMap(Db, (db) =>
    db.scoped((sql, orgId) =>
      Effect.gen(function*() {
        const updated = yield* sql<InvoiceRow>`
          update invoices set status = 'paid', paid_on = (now() at time zone 'UTC')::date
           where organization_id = ${orgId} and id = ${invoiceId} and status = 'open'
          returning ${sql.literal(INVOICE_COLUMNS)}
        `
        if (updated[0] !== undefined) return toInvoice(updated[0])
        const exists = yield* sql<
          { id: string }
        >`select id from invoices where organization_id = ${orgId} and id = ${invoiceId}`
        return yield* (exists.length === 0 ? new InvoiceNotFound({ invoiceId }) : new InvoiceAlreadyPaid({ invoiceId }))
      })
    ))
