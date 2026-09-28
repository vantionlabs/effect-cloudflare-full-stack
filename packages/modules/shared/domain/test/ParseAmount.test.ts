/**
 * The money parser, and specifically the cases where it must refuse.
 *
 * The happy paths here are cheap. The rows that earn their keep are the ambiguous ones: a parser
 * that guessed would pass a naive test suite and be wrong by a factor of a thousand in production.
 */
import { Cents, type Currency, format, Money, parseMoney, parseQuantity, sum } from "@ea/modules/shared/domain/Money"
import { Result } from "effect"
import { describe, expect, it } from "vitest"

const cents = (text: string, currency: Currency = "EUR") => {
  const result = parseMoney(text, currency)
  if (Result.isFailure(result)) throw new Error(`expected ${text} to parse: ${result.failure.reason}`)
  return result.success.minor
}

const failure = (text: string) => {
  const result = parseMoney(text, "EUR")
  if (Result.isSuccess(result)) {
    throw new Error(`expected ${text} to be refused, got ${result.success.minor}`)
  }
  return result.failure.reason
}

describe("parseMoney", () => {
  it("reads both European and Anglo conventions", () => {
    // Unambiguous because BOTH separators appear: the last one is the decimal point.
    expect(cents("1.234,56")).toBe(123456)
    expect(cents("1,234.56")).toBe(123456)
    expect(cents("1.234.567,89")).toBe(123456789)
    expect(cents("1,234,567.89")).toBe(123456789)
  })

  it("reads a single separator with one or two decimals", () => {
    expect(cents("1234,56")).toBe(123456)
    expect(cents("1234.56")).toBe(123456)
    expect(cents("12,5")).toBe(1250)
    expect(cents("0,01")).toBe(1)
  })

  it("reads a bare integer as whole units", () => {
    expect(cents("1234")).toBe(123400)
    expect(cents("0")).toBe(0)
  })

  it("strips currency marks, spaces and non-breaking spaces", () => {
    expect(cents("€ 1.234,56")).toBe(123456)
    expect(cents("EUR 1.234,56")).toBe(123456)
    expect(cents("1 234,56")).toBe(123456)
  })

  it("reads negatives, including trailing-minus and parenthesised credits", () => {
    expect(cents("-1.234,56")).toBe(-123456)
    expect(cents("1.234,56-")).toBe(-123456)
    expect(cents("(1.234,56)")).toBe(-123456)
  })

  it("REFUSES a single separator with exactly three digits after a non-zero group", () => {
    // The case this module exists for. `1.234` is either 1234 or 1.234 and the string does not
    // say which. parseFloat answers 1.234 — confidently, and off by a thousand.
    expect(failure("1.234")).toBe("separator-could-be-either")
    expect(failure("1,234")).toBe("separator-could-be-either")
    expect(failure("12.345")).toBe("separator-could-be-either")
  })

  it("REFUSES more decimals than a cent can hold", () => {
    // Rounding here would invent precision the document did not state.
    expect(failure("1,2345")).toBe("too-many-decimals")
    // A leading zero settles the separator as a decimal point, so this is a precision failure
    // rather than an ambiguity — three decimals is more than a cent can hold.
    expect(failure("0,001")).toBe("too-many-decimals")
  })

  it("REFUSES text that is not a number", () => {
    expect(failure("")).toBe("not-a-number")
    expect(failure("n/a")).toBe("not-a-number")
    expect(failure("twelve")).toBe("not-a-number")
    expect(failure("1.2.3,4,5")).toBe("not-a-number")
    // Malformed grouping, which without an explicit check would silently become 123 — the
    // separators get stripped and the digits run together.
    expect(failure("1.2.3")).toBe("not-a-number")
    expect(failure("12.34,56")).toBe("not-a-number")
  })
})

describe("parseQuantity", () => {
  it("scales to thousandths, so fractional quantities stay integers", () => {
    const quantity = parseQuantity("1,5")
    expect(Result.isSuccess(quantity) && quantity.success).toBe(1500)
    const quarter = parseQuantity("0,25")
    expect(Result.isSuccess(quarter) && quarter.success).toBe(250)
  })

  it("accepts three decimals, which a cent-scaled parse would refuse", () => {
    const precise = parseQuantity("0,125")
    expect(Result.isSuccess(precise) && precise.success).toBe(125)
    // The same string refused as money, for the other reason: a cent cannot hold three decimals.
    expect(failure("0,125")).toBe("too-many-decimals")
  })
})

describe("sum", () => {
  it("adds amounts in one currency", () => {
    const total = sum(
      [
        new Money({ minor: Cents.make(1050), currency: "EUR" }),
        new Money({ minor: Cents.make(2500), currency: "EUR" })
      ],
      "EUR"
    )
    expect(Result.isSuccess(total) && total.success.minor).toBe(3550)
  })

  it("REFUSES to add across currencies", () => {
    // A sum of euros and dollars has no meaning. On the totals rail it would be a confident,
    // internally consistent, wrong answer — so it must not be expressible as a success.
    const total = sum(
      [
        new Money({ minor: Cents.make(1000), currency: "EUR" }),
        new Money({ minor: Cents.make(1000), currency: "USD" })
      ],
      "EUR"
    )
    expect(Result.isFailure(total) && total.failure._tag).toBe("CurrencyMismatch")
  })
})

describe("format", () => {
  it("renders the Dutch convention, which is what the reviewer sees", () => {
    expect(format(new Money({ minor: Cents.make(123456), currency: "EUR" }))).toBe("EUR 1.234,56")
    expect(format(new Money({ minor: Cents.make(-1), currency: "EUR" }))).toBe("-EUR 0,01")
    expect(format(new Money({ minor: Cents.make(0), currency: "EUR" }))).toBe("EUR 0,00")
  })

  it("round-trips every parseable amount", () => {
    for (const text of ["1.234,56", "0,01", "-99,99", "1.000.000,00"]) {
      const money = parseMoney(text, "EUR")
      expect(Result.isSuccess(money)).toBe(true)
      if (Result.isSuccess(money)) {
        expect(cents(format(money.success).replace("EUR ", ""))).toBe(money.success.minor)
      }
    }
  })
})
