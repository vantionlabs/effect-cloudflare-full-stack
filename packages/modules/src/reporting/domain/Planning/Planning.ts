/**
 * Work in progress and the cash it should bring in — computed in code, from facts, with every assumption named.
 *
 * Three sources of expected cash, each dated:
 * - an OPEN INVOICE is expected on its due date; past due, it is OVERDUE and counted apart, not in a future week;
 * - a FINISHED job not yet invoiced is assumed invoiced today, so it is due after the payment terms;
 * - an OPEN job is assumed finished `OPEN_JOB_DAYS` after acceptance (or today, if that has passed), then invoiced,
 *   then due after the payment terms.
 * Sent quotes the customer has not answered are PIPELINE: shown, never counted as expected cash.
 *
 * This is an INFLOW forecast. The product records no expenses, so it cannot show a balance, and says so rather
 * than implying one. Amounts are integer cents throughout.
 */
import { PAYMENT_TERMS_DAYS } from "@ea/modules/shared/domain/Money"
import { Schema } from "effect"

/** An open job is assumed to be finished this many days after the customer accepted. A stated assumption. */
export const OPEN_JOB_DAYS = 14

/** How far ahead the forecast looks, in weeks. Anything later is summed as `later`. */
export const FORECAST_WEEKS = 12

const DAY_MS = 86_400_000

export interface PlanningInputs {
  readonly openInvoices: ReadonlyArray<{ readonly amountCents: number; readonly dueOn: string }>
  readonly doneJobs: ReadonlyArray<{ readonly valueCents: number }>
  readonly openJobs: ReadonlyArray<{ readonly valueCents: number; readonly acceptedOn: string }>
  readonly sentQuotes: ReadonlyArray<{ readonly totalCents: number }>
}

const Amount = Schema.Struct({ count: Schema.Int, cents: Schema.Int })

export class PlanningView extends Schema.Class<PlanningView>("PlanningView")({
  today: Schema.String,
  assumptions: Schema.Struct({ paymentTermsDays: Schema.Int, openJobDays: Schema.Int }),
  workInProgress: Schema.Struct({ openJobs: Amount, doneNotInvoiced: Amount }),
  openInvoices: Amount,
  overdue: Amount,
  pipeline: Amount,
  /** Weeks start on Monday; the first is the week containing `today`. */
  weeks: Schema.Array(Schema.Struct({
    weekStart: Schema.String,
    fromInvoices: Schema.Int,
    fromWork: Schema.Int,
    total: Schema.Int
  })),
  /** Expected after the last forecast week. */
  later: Schema.Int
}) {}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const parse = (iso: string) => Date.parse(`${iso}T00:00:00Z`)
const amount = (values: ReadonlyArray<number>) => ({ count: values.length, cents: values.reduce((a, b) => a + b, 0) })

export const planCash = (today: string, inputs: PlanningInputs): PlanningView => {
  const todayMs = parse(today)
  const sinceMonday = (new Date(todayMs).getUTCDay() + 6) % 7
  const firstWeek = todayMs - sinceMonday * DAY_MS
  const weeks = Array.from({ length: FORECAST_WEEKS }, (_, index) => ({
    weekStart: day(firstWeek + index * 7 * DAY_MS),
    fromInvoices: 0,
    fromWork: 0,
    total: 0
  }))
  let later = 0
  const place = (dueMs: number, cents: number, source: "fromInvoices" | "fromWork") => {
    const index = Math.floor((dueMs - firstWeek) / (7 * DAY_MS))
    const week = weeks[index]
    if (week === undefined) later += cents
    else {
      week[source] += cents
      week.total += cents
    }
  }

  const overdue = inputs.openInvoices.filter((invoice) => parse(invoice.dueOn) < todayMs)
  for (const invoice of inputs.openInvoices) {
    if (parse(invoice.dueOn) >= todayMs) place(parse(invoice.dueOn), invoice.amountCents, "fromInvoices")
  }
  for (const job of inputs.doneJobs) place(todayMs + PAYMENT_TERMS_DAYS * DAY_MS, job.valueCents, "fromWork")
  for (const job of inputs.openJobs) {
    const finished = Math.max(todayMs, parse(job.acceptedOn) + OPEN_JOB_DAYS * DAY_MS)
    place(finished + PAYMENT_TERMS_DAYS * DAY_MS, job.valueCents, "fromWork")
  }

  return new PlanningView({
    today,
    assumptions: { paymentTermsDays: PAYMENT_TERMS_DAYS, openJobDays: OPEN_JOB_DAYS },
    workInProgress: {
      openJobs: amount(inputs.openJobs.map((job) => job.valueCents)),
      doneNotInvoiced: amount(inputs.doneJobs.map((job) => job.valueCents))
    },
    openInvoices: amount(inputs.openInvoices.map((invoice) => invoice.amountCents)),
    overdue: amount(overdue.map((invoice) => invoice.amountCents)),
    pipeline: amount(inputs.sentQuotes.map((quote) => quote.totalCents)),
    weeks,
    later
  })
}
