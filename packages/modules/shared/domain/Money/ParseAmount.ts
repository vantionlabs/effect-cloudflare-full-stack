/**
 * Turning the digits a document prints into a scaled integer — and refusing when it is ambiguous.
 *
 * This exists because the obvious implementation is wrong in a way that is invisible. A document
 * showing `1.234,56` is Dutch: one thousand two hundred thirty-four euros and fifty-six cents.
 * `Number("1.234,56")` is `NaN`; `parseFloat("1.234,56")` is **1.234**. The second is the dangerous
 * one — it succeeds, it is off by a factor of a thousand, and every downstream check passes because
 * the arithmetic is self-consistent. The result is an authorisation to pay the wrong amount with a
 * complete and entirely convincing audit trail.
 *
 * So the rule is: read the separators, and when they do not determine a single reading, **fail**.
 * A failure is not a rejection of the invoice — it forces the case to a human with the unreadable
 * figure named, which is the correct outcome for a number we cannot read exactly.
 *
 * `1.234` is the case worth dwelling on. It is either one thousand two hundred thirty-four (Dutch
 * thousands separator) or one and a bit (decimal point), and nothing in the string decides it. Both
 * readings are plausible and they differ by three orders of magnitude, so this returns
 * `AmbiguousAmount`. Guessing by locale would be worse than failing: it would be right most of the
 * time, which is precisely how this class of bug survives to production.
 */
import { Result, Schema } from "effect"

/** Why an amount could not be read. Carries the original text so a reviewer sees what we saw. */
export class AmbiguousAmount extends Schema.TaggedError<AmbiguousAmount>()("AmbiguousAmount", {
  text: Schema.String,
  reason: Schema.Literals([
    /** A single separator followed by exactly three digits: thousands or decimal, unknowable. */
    "separator-could-be-either",
    /** More fractional digits than the scale can hold. Rounding here would invent precision. */
    "too-many-decimals",
    /** No digits, or characters we will not silently discard. */
    "not-a-number"
  ])
}) {}

/** Characters stripped before parsing: currency marks, spaces (including NBSP), the Dutch `-,--`. */
const NOISE = /[\s  €$£¥]|EUR|USD|GBP/gi

/**
 * Whether the integer part uses one consistent thousands separator in groups of three.
 *
 * `1.234.567` yes, `1234567` yes, `1.2.3` no, `1.234,567` no (mixed characters), `12.34` no.
 */
const isWellGrouped = (whole: string): boolean => {
  const separators = new Set(whole.match(/[.,]/g) ?? [])
  if (separators.size === 0) return true
  if (separators.size > 1) return false
  const groups = whole.split(/[.,]/)
  return groups[0]!.length >= 1 && groups[0]!.length <= 3 &&
    groups.slice(1).every((group) => group.length === 3)
}

/**
 * Reads `text` as an integer at `scale` decimal places.
 *
 * `scale` is 2 for money (cents) and 3 for quantities (thousandths). The returned integer is
 * unbranded on purpose — the caller brands it, because only the caller knows which unit it is in.
 */
export const parseScaledInteger = (
  text: string,
  scale: number
): Result.Result<number, AmbiguousAmount> => {
  const cleaned = text.replace(NOISE, "")
  const negative = /^[-(]/.test(cleaned) || cleaned.endsWith("-")
  const digitsAndSeparators = cleaned.replace(/^[-(+]|[)-]$/g, "")

  if (!/^[\d.,]*\d[\d.,]*$/.test(digitsAndSeparators)) {
    return Result.fail(new AmbiguousAmount({ text, reason: "not-a-number" }))
  }

  const lastDot = digitsAndSeparators.lastIndexOf(".")
  const lastComma = digitsAndSeparators.lastIndexOf(",")
  const lastSeparator = Math.max(lastDot, lastComma)

  let whole: string
  let fraction: string

  if (lastSeparator === -1) {
    whole = digitsAndSeparators
    fraction = ""
  } else {
    const trailing = digitsAndSeparators.length - lastSeparator - 1
    // Both separator characters present: the LAST one is the decimal point and the other is a
    // thousands separator. `1.234,56` and `1,234.56` are both unambiguous for this reason.
    const bothPresent = lastDot !== -1 && lastComma !== -1
    // A single separator with exactly three digits after it: thousands separator or decimal point?
    // `1.234` is either 1234 or 1.234 and the string does not say which.
    //
    // Unless the part before it is a lone zero. A thousands group is never written `0,125` — that
    // would be "zero thousand one hundred twenty-five" — so a leading zero settles it as a decimal.
    // This matters for quantities, where `0,125` of a unit is an ordinary thing to invoice.
    const couldBeThousands = !/^0*$/.test(digitsAndSeparators.slice(0, lastSeparator))
    if (!bothPresent && trailing === 3 && couldBeThousands) {
      return Result.fail(new AmbiguousAmount({ text, reason: "separator-could-be-either" }))
    }
    if (trailing > scale) {
      return Result.fail(new AmbiguousAmount({ text, reason: "too-many-decimals" }))
    }
    whole = digitsAndSeparators.slice(0, lastSeparator)
    fraction = digitsAndSeparators.slice(lastSeparator + 1)
  }

  // A separator in the fraction is never valid.
  if (/[.,]/.test(fraction)) {
    return Result.fail(new AmbiguousAmount({ text, reason: "not-a-number" }))
  }
  // Grouping in the whole part must be well formed, or it is not a number we can read. Without
  // this, `1.2.3` quietly becomes 123: the separators get stripped and the digits run together,
  // which is the same silent-wrong-answer failure the whole module exists to prevent.
  if (!isWellGrouped(whole)) {
    return Result.fail(new AmbiguousAmount({ text, reason: "not-a-number" }))
  }
  const wholeDigits = whole.replace(/[.,]/g, "")

  const scaled = Number(`${wholeDigits || "0"}${fraction.padEnd(scale, "0")}`)
  if (!Number.isSafeInteger(scaled)) {
    return Result.fail(new AmbiguousAmount({ text, reason: "not-a-number" }))
  }

  return Result.succeed(negative ? -scaled : scaled)
}
