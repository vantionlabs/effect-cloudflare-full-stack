/**
 * Work after a sale: a JOB for every accepted quote, and an INVOICE for every finished job.
 *
 *   job:      open ──complete──▶ done ──invoice──▶ invoiced
 *   invoice:  open ──record payment──▶ paid          (overdue = open past its due date; derived, never stored)
 *
 * Values are copied at creation — a job's from the quote's total, an invoice's from the job's — so what was agreed
 * and what was billed can never be rewritten by a later change.
 */
import { Cents } from "@ea/modules/shared/domain/Money"
import { Schema } from "effect"

export const JobId = Schema.String.pipe(Schema.brand("JobId"))
export type JobId = typeof JobId.Type

export const JobStatus = Schema.Literals(["open", "done", "invoiced"])
export type JobStatus = typeof JobStatus.Type

export class Job extends Schema.Class<Job>("Job")({
  id: JobId,
  quoteId: Schema.String,
  customerName: Schema.NullOr(Schema.String),
  status: JobStatus,
  /** The accepted quote's total, including VAT. */
  value: Cents,
  acceptedAt: Schema.String,
  completedAt: Schema.NullOr(Schema.String)
}) {}

export const InvoiceStatus = Schema.Literals(["open", "paid"])
export type InvoiceStatus = typeof InvoiceStatus.Type

export class Invoice extends Schema.Class<Invoice>("Invoice")({
  id: Schema.String,
  jobId: Schema.String,
  customerName: Schema.NullOr(Schema.String),
  amount: Cents,
  issuedOn: Schema.String,
  dueOn: Schema.String,
  status: InvoiceStatus,
  paidOn: Schema.NullOr(Schema.String)
}) {}
