/**
 * Turns an extracted invoice into the facts `evaluateRule` bounds.
 *
 * The invoice knows nothing about rules and the rule knows nothing about invoices; this is the one file
 * that maps between them, so adding a vertical means writing a sibling of this and nothing else.
 *
 * **Everything unreadable becomes `null`, and `evaluateRule` treats `null` as unmet.** That direction is
 * the whole design: an amount `parseMoney` refused, or a date pair in a format this does not recognise,
 * means a bound cannot be *shown* to hold — and a bound that cannot be shown to hold has not held. The
 * opposite convention, skipping a check whose input is missing, is how an invoice with an unparseable
 * total walks past a ceiling.
 */
import { type Currency, parseMoney } from "@ea/modules/shared/domain/Money"
import { Result } from "effect"
import type { RuleFacts } from "../Rule/Rule.ts"
import type { Invoice } from "./Invoice.ts"

/** Dutch month names, lower-cased, plus the abbreviations that appear on real invoices. */
const MONTHS: Record<string, number> = {
  januari: 0,
  jan: 0,
  februari: 1,
  feb: 1,
  maart: 2,
  mrt: 2,
  april: 3,
  apr: 3,
  mei: 4,
  juni: 5,
  jun: 5,
  juli: 6,
  jul: 6,
  augustus: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  oktober: 9,
  okt: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11
}

/**
 * Builds a UTC date, or null when the components do not describe a real day.
 *
 * `Date.UTC` **rolls over silently**: `Date.UTC(2026, 0, 32)` is 1 February, and `Date.UTC(2027, 1, 29)`
 * is 1 March. So a range check on the month is not enough — `32-01-2026` parsed cleanly into a wrong
 * date until a test asked for it. Round-tripping the components is the only check that catches both the
 * out-of-range day and the leap-year case, and it needs no calendar table.
 */
const utcDay = (year: number, month: number, day: number): Date | null => {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null
  const date = new Date(Date.UTC(year, month, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day
    ? date
    : null
}

/**
 * Reads a printed date, or returns null.
 *
 * Three formats, all unambiguous, and **nothing else** — no heuristics and no `new Date(text)` fallback.
 * `Date`'s own parser accepts almost anything and guesses month-first on `03/04/2026`, which on a Dutch
 * invoice is 3 April and would be read as 4 March. A date read wrongly by a month is worse than a date
 * not read at all, because the second one escalates and the first one quietly changes the answer.
 */
export const parsePrintedDate = (text: string): Date | null => {
  const trimmed = text.trim()

  // 1. ISO: 2026-02-12.
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (iso !== null) {
    return utcDay(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
  }

  // 2. Dutch long form: 12 februari 2026.
  const long = /^(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})$/i.exec(trimmed)
  if (long !== null) {
    const month = MONTHS[long[2]!.toLowerCase()]
    if (month !== undefined) return utcDay(Number(long[3]), month, Number(long[1]))
    return null
  }

  // 3. Dutch numeric, day first, with a dash or a dot: 12-02-2026, 12.02.2026.
  //    A SLASH is deliberately excluded: `03/04/2026` is day-first in the Netherlands and month-first in
  //    the US, and an invoice does not say which convention its author used.
  const numeric = /^(\d{1,2})[-.](\d{1,2})[-.](\d{4})$/.exec(trimmed)
  if (numeric !== null) {
    return utcDay(Number(numeric[3]), Number(numeric[2]) - 1, Number(numeric[1]))
  }

  return null
}

/** Whole days between two printed dates, or null when either is unreadable or the order is wrong. */
const daysBetween = (from: string, to: string): number | null => {
  const start = parsePrintedDate(from)
  const end = parsePrintedDate(to)
  if (start === null || end === null) return null
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000)
  // A due date before the issue date is not a short payment term, it is a document we cannot read.
  return days < 0 ? null : days
}

export const invoiceRuleFacts = (invoice: Invoice): RuleFacts => {
  const currency = invoice.currency.value as Currency
  const total = parseMoney(invoice.total_incl_vat.value, currency)

  return {
    totalMinor: Result.isSuccess(total) ? total.success.minor : null,
    currency,
    supplier: invoice.supplier.value,
    // An absent `po_number` and an empty one are both "the invoice states none"; `evaluateRule` treats
    // them identically, and collapsing them here keeps that decision in one place.
    poNumber: invoice.po_number?.value ?? null,
    paymentDays: invoice.due_on === undefined
      ? null
      : daysBetween(invoice.issued_on.value, invoice.due_on.value)
  }
}
