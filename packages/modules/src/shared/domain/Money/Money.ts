/**
 * An amount with its currency, and the refusal to add across currencies.
 *
 * Currency is part of the value rather than context because the alternative — a bare `Cents` and a
 * currency held somewhere alongside it — makes `add` compile for two amounts in different
 * currencies. That sum has no meaning, and on an invoice rail it would produce a confident,
 * arithmetically consistent, wrong answer.
 */
import { Result, Schema } from "effect"
import { Cents, Milli, type PerMille } from "./Cents.ts"
import { type AmbiguousAmount, parseScaledInteger } from "./ParseAmount.ts"

/** ISO 4217. A closed set rather than `string`: an unrecognised code means the parse is wrong. */
export const Currency = Schema.Literals(["EUR", "USD", "GBP"])
export type Currency = typeof Currency.Type

export class Money extends Schema.Class<Money>("Money")({
  minor: Cents,
  currency: Currency
}) {}

/** Why two amounts could not be combined. */
export class CurrencyMismatch extends Schema.TaggedError<CurrencyMismatch>()("CurrencyMismatch", {
  left: Currency,
  right: Currency
}) {}

export const add = (left: Money, right: Money): Result.Result<Money, CurrencyMismatch> =>
  left.currency === right.currency
    ? Result.succeed(new Money({ minor: Cents.make(left.minor + right.minor), currency: left.currency }))
    : Result.fail(new CurrencyMismatch({ left: left.currency, right: right.currency }))

/**
 * Sums amounts, refusing a mixed-currency list. An empty list needs a currency to answer in, which
 * is why it is a parameter rather than inferred — there is no zero without one.
 */
export const sum = (
  amounts: ReadonlyArray<Money>,
  currency: Currency
): Result.Result<Money, CurrencyMismatch> =>
  amounts.reduce<Result.Result<Money, CurrencyMismatch>>(
    (total, amount) => Result.flatMap(total, (running) => add(running, amount)),
    Result.succeed(new Money({ minor: Cents.make(0), currency }))
  )

/** Reads a printed amount into `Money`. Two decimal places; fails rather than guessing. */
export const parseMoney = (
  text: string,
  currency: Currency
): Result.Result<Money, AmbiguousAmount> =>
  Result.map(parseScaledInteger(text, 2), (minor) => new Money({ minor: Cents.make(minor), currency }))

/** Reads a printed quantity into thousandths. Three decimal places. */
export const parseQuantity = (text: string): Result.Result<Milli, AmbiguousAmount> =>
  Result.map(parseScaledInteger(text, 3), (milli) => Milli.make(milli))

/** Renders an amount the way the reviewer console shows it. Dutch convention: `1.234,56`. */
export const format = (money: Money): string => {
  const negative = money.minor < 0
  const absolute = Math.abs(money.minor)
  const whole = Math.trunc(absolute / 100).toLocaleString("nl-NL")
  const cents = String(absolute % 100).padStart(2, "0")
  return `${negative ? "-" : ""}${money.currency} ${whole},${cents}`
}

/** Renders a rate as a percentage, for naming a failing VAT check to a human. */
export const formatRate = (rate: PerMille): string => `${(rate / 10).toFixed(1)}%`
