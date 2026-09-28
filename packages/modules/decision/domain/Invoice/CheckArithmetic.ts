/**
 * The second model-free check: do the numbers on this invoice add up?
 *
 * A model asked to total a column will sometimes total it wrong, and there is no reason to ask.
 * These checks are deterministic, free, and they catch both a bad parse and a doctored invoice.
 *
 * **A failure here is never a rejection.** It is a reason the case goes to a human, with the failing
 * sum named so the reviewer knows where to look. Rejecting an invoice because our arithmetic
 * disagreed with the supplier's would be the product deciding something it is not entitled to.
 *
 * Everything is integer. `quantity` is in thousandths, amounts in cents, VAT rates in per-mille, and
 * the one place the scales meet is `lineAmount`. No float touches any of it — see `Cents.ts`.
 */
import {
  type Cents,
  Cents as CentsSchema,
  formatRate,
  lineAmount,
  type Money,
  parseMoney,
  parseQuantity,
  type PerMille,
  PerMille as PerMilleSchema,
  rateInPerMille
} from "@ea/modules/shared/domain/Money"
import { Result } from "effect"
import type { Invoice } from "./Invoice.model.ts"

/**
 * Rounding slack, in cents. Invoices round per line, so a cent or two of drift on a multi-line total
 * is normal; anything larger is a real disagreement rather than a representation artefact.
 */
const TOLERANCE_CENTS = 2

/** The legal Dutch VAT rates, in per-mille. A rate outside this set means the parse is wrong, or
 * the invoice is. Exact integers, so there is no epsilon to choose here. */
const LEGAL_VAT_PER_MILLE: ReadonlyArray<PerMille> = [0, 90, 210].map((rate) => PerMilleSchema.make(rate))

/** How far a computed rate may sit from a legal one, in per-mille. 5 ‰ is half a percentage point. */
const VAT_TOLERANCE_PER_MILLE = 5

export interface ArithmeticReport {
  /** Human-readable, each naming the specific sum that disagreed. Shown to the reviewer verbatim. */
  readonly failures: ReadonlyArray<string>
}

export const arithmeticOk = (report: ArithmeticReport): boolean => report.failures.length === 0

/** Reads one printed figure, recording a failure instead of throwing when it cannot be read. */
const read = (
  text: string,
  currency: Money["currency"],
  label: string,
  failures: Array<string>
): Cents | undefined => {
  const parsed = parseMoney(text, currency)
  if (Result.isFailure(parsed)) {
    // An amount we cannot read exactly is not one we should decide on, so this lands in the same
    // report as a failed sum and has the same consequence: a human looks at it.
    failures.push(`${label} reads "${text}", which cannot be read as an amount (${parsed.failure.reason})`)
    return undefined
  }
  return parsed.success.minor
}

export const checkArithmetic = (invoice: Invoice): ArithmeticReport => {
  const failures: Array<string> = []
  const currency = invoice.currency.value

  const total = read(invoice.total_incl_vat.value, currency, "total including VAT", failures)
  const vat = read(invoice.vat_amount.value, currency, "VAT amount", failures)
  if (total === undefined || vat === undefined) return { failures }

  // The invoice's own two numbers, not a third one we asked the model for.
  const subtotal = CentsSchema.make(total - vat)

  invoice.line_items.forEach((line, index) => {
    const position = index + 1
    const quantity = parseQuantity(line.quantity.value)
    const unitPrice = read(line.unit_price.value, currency, `line ${position} unit price`, failures)
    const amount = read(line.amount.value, currency, `line ${position} amount`, failures)

    if (Result.isFailure(quantity)) {
      failures.push(
        `line ${position} quantity reads "${line.quantity.value}", which cannot be read as a number ` +
          `(${quantity.failure.reason})`
      )
      return
    }
    if (unitPrice === undefined || amount === undefined) return

    const expected = lineAmount(quantity.success, unitPrice)
    if (Math.abs(expected - amount) > TOLERANCE_CENTS) {
      failures.push(
        `line ${position}: ${line.quantity.value} × ${line.unit_price.value} is ${expected / 100}, ` +
          `but the line reads ${amount / 100}`
      )
    }
  })

  if (invoice.line_items.length > 0) {
    const lineTotals = invoice.line_items.map((line) => parseMoney(line.amount.value, currency))
    if (lineTotals.every(Result.isSuccess)) {
      const summed = lineTotals.reduce((running, line) => running + line.success.minor, 0)
      if (Math.abs(summed - subtotal) > TOLERANCE_CENTS) {
        failures.push(
          `line items sum to ${summed / 100}, but total minus VAT is ${subtotal / 100}`
        )
      }
    }
  }

  if (subtotal < 0) {
    failures.push(`VAT ${vat / 100} exceeds the total ${total / 100}`)
  } else if (subtotal === 0) {
    if (vat !== 0) failures.push(`VAT is ${vat / 100} on a subtotal of zero`)
  } else {
    const rate = rateInPerMille(vat, subtotal)
    if (rate === undefined) {
      failures.push("VAT rate could not be computed")
    } else if (!LEGAL_VAT_PER_MILLE.some((legal) => Math.abs(rate - legal) <= VAT_TOLERANCE_PER_MILLE)) {
      failures.push(
        `VAT works out to ${formatRate(rate)}, which is not a legal Dutch rate ` +
          `(${LEGAL_VAT_PER_MILLE.map((legal) => formatRate(legal)).join(", ")})`
      )
    }
  }

  return { failures }
}
