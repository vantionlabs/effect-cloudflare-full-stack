/**
 * Work in progress and the cash it should bring in and send out — computed in code, from facts, with every
 * assumption named.
 *
 * Three sources of expected cash IN, each dated:
 * - an OPEN INVOICE is expected on its due date; past due, it is OVERDUE and counted apart, not in a future week;
 * - a FINISHED job not yet invoiced is assumed invoiced today, so it is due after its customer's payment terms;
 * - an OPEN job is assumed finished `OPEN_JOB_DAYS` after acceptance (or today, if that has passed), then invoiced,
 *   then due after its customer's payment terms.
 * Sent quotes the customer has not answered are PIPELINE: shown, never counted as expected cash.
 *
 * Cash OUT is the recorded EXPENSES, each assumed paid on its date: a one-off on its day, a monthly one on that day
 * of every month until it is stopped. Expenses already past are history, not forecast.
 *
 * The product does not know the bank balance, so `runningNet` is the CHANGE in cash from today, not a balance — and
 * the view says so rather than implying one. Amounts are integer cents throughout.
 */
import { PAYMENT_TERMS_DAYS } from "@ea/modules/shared/domain/Money"
import { Schema } from "effect"

/** An open job is assumed to be finished this many days after the customer accepted. A stated assumption. */
export const OPEN_JOB_DAYS = 14

/** How far ahead the forecast looks, in weeks. Anything later is summed as `later`. */
export const FORECAST_WEEKS = 12

const DAY_MS = 86_400_000

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const parse = (iso: string) => Date.parse(`${iso}T00:00:00Z`)

export interface PlanningExpense {
  readonly amountCents: number
  readonly startsOn: string
  readonly repeat: "once" | "monthly"
  readonly stoppedOn: string | null
}

export interface PlanningInputs {
  readonly openInvoices: ReadonlyArray<{ readonly amountCents: number; readonly dueOn: string }>
  /** `termsDays` is the customer's own terms, or the default when the customer has none. */
  readonly doneJobs: ReadonlyArray<{ readonly valueCents: number; readonly termsDays: number }>
  readonly openJobs: ReadonlyArray<
    { readonly valueCents: number; readonly acceptedOn: string; readonly termsDays: number }
  >
  readonly sentQuotes: ReadonlyArray<{ readonly totalCents: number }>
  readonly expenses: ReadonlyArray<PlanningExpense>
  /** How many customers have terms other than the default — reported, so the assumption is visible. */
  readonly customersWithOwnTerms: number
}

const Amount = Schema.Struct({ count: Schema.Int, cents: Schema.Int })

export class PlanningView extends Schema.Class<PlanningView>("PlanningView")({
  today: Schema.String,
  assumptions: Schema.Struct({
    /** The DEFAULT terms; customers with their own terms are counted in `customersWithOwnTerms`. */
    paymentTermsDays: Schema.Int,
    customersWithOwnTerms: Schema.Int,
    openJobDays: Schema.Int
  }),
  workInProgress: Schema.Struct({ openJobs: Amount, doneNotInvoiced: Amount }),
  openInvoices: Amount,
  overdue: Amount,
  pipeline: Amount,
  /** Weeks start on Monday; the first is the week containing `today`. */
  weeks: Schema.Array(Schema.Struct({
    weekStart: Schema.String,
    fromInvoices: Schema.Int,
    fromWork: Schema.Int,
    /** Cash in: `fromInvoices + fromWork`. */
    total: Schema.Int,
    /** Cash out: expenses falling in this week. */
    out: Schema.Int,
    /** `total - out`. */
    net: Schema.Int,
    /** The sum of `net` up to and including this week — the change in cash from today, NOT a balance. */
    runningNet: Schema.Int
  })),
  /** Cash in expected after the last forecast week. Expenses are not summed beyond it: a monthly one never ends. */
  later: Schema.Int
}) {}

/** The days an expense is paid on, from `fromMs` (inclusive) to `toMs` (exclusive). */
export const expenseDates = (expense: PlanningExpense, fromMs: number, toMs: number): ReadonlyArray<number> => {
  const start = parse(expense.startsOn)
  const stop = expense.stoppedOn === null ? Number.POSITIVE_INFINITY : parse(expense.stoppedOn)
  const within = (ms: number) => ms >= fromMs && ms < toMs && ms >= start && ms < stop
  if (expense.repeat === "once") return within(start) ? [start] : []
  const first = new Date(start)
  const dayOfMonth = first.getUTCDate()
  const dates: Array<number> = []
  for (let month = 0;; month++) {
    const year = first.getUTCFullYear()
    const monthIndex = first.getUTCMonth() + month
    // The last day of the month when it is shorter than the expense's day: the 31st falls on 30 April.
    const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
    const ms = Date.UTC(year, monthIndex, Math.min(dayOfMonth, lastDay))
    if (ms >= toMs || ms >= stop) return dates
    if (within(ms)) dates.push(ms)
  }
}

const amount = (values: ReadonlyArray<number>) => ({ count: values.length, cents: values.reduce((a, b) => a + b, 0) })

export const planCash = (today: string, inputs: PlanningInputs): PlanningView => {
  const todayMs = parse(today)
  const sinceMonday = (new Date(todayMs).getUTCDay() + 6) % 7
  const firstWeek = todayMs - sinceMonday * DAY_MS
  const weeks = Array.from({ length: FORECAST_WEEKS }, (_, index) => ({
    weekStart: day(firstWeek + index * 7 * DAY_MS),
    fromInvoices: 0,
    fromWork: 0,
    total: 0,
    out: 0,
    net: 0,
    runningNet: 0
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
  for (const job of inputs.doneJobs) place(todayMs + job.termsDays * DAY_MS, job.valueCents, "fromWork")
  for (const job of inputs.openJobs) {
    const finished = Math.max(todayMs, parse(job.acceptedOn) + OPEN_JOB_DAYS * DAY_MS)
    place(finished + job.termsDays * DAY_MS, job.valueCents, "fromWork")
  }

  const horizonEnd = firstWeek + FORECAST_WEEKS * 7 * DAY_MS
  for (const expense of inputs.expenses) {
    for (const ms of expenseDates(expense, todayMs, horizonEnd)) {
      const week = weeks[Math.floor((ms - firstWeek) / (7 * DAY_MS))]
      if (week !== undefined) week.out += expense.amountCents
    }
  }
  let running = 0
  for (const week of weeks) {
    week.net = week.total - week.out
    running += week.net
    week.runningNet = running
  }

  return new PlanningView({
    today,
    assumptions: {
      paymentTermsDays: PAYMENT_TERMS_DAYS,
      customersWithOwnTerms: inputs.customersWithOwnTerms,
      openJobDays: OPEN_JOB_DAYS
    },
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
