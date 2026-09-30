/**
 * Integer minor units, and the two other scaled integers this product counts in.
 *
 * **No float ever touches money here.** The rail that checks totals is the one place a rounding
 * artefact becomes a wrong decision with a perfect audit trail, so amounts are integers in the
 * smallest unit and stay integers from extraction through the database column to the response.
 * `0.1 + 0.2 !== 0.3` is not a curiosity when the output is an approval to pay a supplier.
 *
 * Three scales, because three things are counted and conflating them is the mistake:
 *
 *   `Cents`    1/100 of a currency unit. Every amount.
 *   `Milli`    1/1000 of a unit of measure. Quantities, which are genuinely fractional
 *              (0.25 hours, 1.5 kg) and which multiply against a price.
 *   `PerMille` 1/1000. Rates. A 21% VAT rate is 210, exactly, with no representation error.
 *
 * The brands are not decoration: `Cents` and `Milli` are both integers, so without them
 * `quantity * unitPrice` type-checks while being off by a factor of ten.
 */
import { Schema } from "effect"

/** An amount in 1/100 of a currency unit. Negative is allowed — credit notes exist. */
export const Cents = Schema.Int.pipe(Schema.brand("Cents"))
export type Cents = typeof Cents.Type

/** A quantity in 1/1000 of a unit of measure. Three decimals covers every invoice seen so far. */
export const Milli = Schema.Int.pipe(Schema.brand("Milli"))
export type Milli = typeof Milli.Type

/** A rate in 1/1000. 21% is 210. */
export const PerMille = Schema.Int.pipe(Schema.brand("PerMille"))
export type PerMille = typeof PerMille.Type

/** How many thousandths are in one whole. Named so the `/ 1000` below is not a bare literal. */
const MILLI_SCALE = 1000

/**
 * `quantity × unitPrice`, rounded half-up to the cent.
 *
 * The one place the two scales meet, which is exactly why it is a named function rather than an
 * expression at three call sites: `Milli × Cents` is in units of 1/1000 of a cent, and forgetting
 * to divide is a thousand-fold error that still looks like money.
 *
 * Half-up rather than banker's rounding because that is what invoices do — the supplier's own
 * arithmetic is what we are checking against, not a statistically unbiased ideal.
 */
export const lineAmount = (quantity: Milli, unitPrice: Cents): Cents =>
  Cents.make(Math.round((quantity * unitPrice) / MILLI_SCALE))

/**
 * `part / whole` as a rate in per-mille, rounded. `undefined` when `whole` is zero.
 *
 * Returns `undefined` rather than throwing or yielding Infinity because "what VAT rate is this?"
 * genuinely has no answer on a zero subtotal, and the caller has a specific thing to say about
 * that case.
 */
export const rateInPerMille = (part: Cents, whole: Cents): PerMille | undefined =>
  whole === 0 ? undefined : PerMille.make(Math.round((part * MILLI_SCALE) / whole))
