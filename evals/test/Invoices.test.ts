/**
 * The labelled set's own invariants.
 *
 * Every number the eval harness reports is a measurement taken through this generator, so a bug here
 * does not produce a failing test — it produces a plausible, wrong score. Three of these properties
 * were bugs in an earlier draft of exactly this kind of harness, and each one is invisible downstream:
 *
 * - **spans that do not occur in the document** make rail 1 fire on every case, and the report reads
 *   "the model is ungrounded" when in fact the fixture is;
 * - **a "clean" case that fails the arithmetic check** removes the only cases that could ever reach
 *   `auto_approve`, so the auto-approve gate is never exercised and reports zero false approvals;
 * - **a non-deterministic set** makes today's score incomparable to yesterday's, silently.
 */
import { verifySpans } from "@ea/modules/decision/domain/Extraction"
import { checkArithmetic } from "@ea/modules/decision/domain/Invoice"
import { describe, expect, it } from "vitest"
import { buildInvoices, euros, MUST_NOT_AUTO_APPROVE, SCENARIOS } from "../fixtures/Invoices.ts"

const SET = buildInvoices(99)

describe("the labelled set", () => {
  it("is deterministic for a given seed, and different for a different one", () => {
    // The whole point of a seed. JavaScript has no seedable Math.random, so a generator that reached
    // for it would produce a set that cannot be compared across runs — and would look fine.
    const a = buildInvoices(30, 7)
    const b = buildInvoices(30, 7)
    const c = buildInvoices(30, 8)
    expect(a.map((row) => row.markdown)).toEqual(b.map((row) => row.markdown))
    expect(a.map((row) => row.markdown)).not.toEqual(c.map((row) => row.markdown))
  })

  it("covers every scenario at 99 documents", () => {
    // A scenario that never appears is a gate that silently stops testing anything.
    const seen = new Set(SET.map((row) => row.scenario.key))
    for (const scenario of SCENARIOS) expect(seen).toContain(scenario.key)
  })

  it("is mostly clean, because real intake is", () => {
    const clean = SET.filter((row) => row.scenario.expected === "auto_approve").length
    // Not an exact number: the weights decide it, and pinning the count here would make changing a
    // weight fail this test for no reason. The property is the shape of the distribution.
    expect(clean).toBeGreaterThan(SET.length * 0.25)
    expect(clean).toBeLessThan(SET.length * 0.5)
  })
})

describe("every span occurs in the document it was read from", () => {
  it("verifies for all 99, with no exceptions", () => {
    // THE load-bearing property. `asExtractionFields` and `render` share one formatter for exactly
    // this reason: a generator that wrote `1234.56` in the span and `1.234,56` on the page would fail
    // here, and would otherwise present as a grounding failure on every single case.
    const failures = SET
      .map((row) => ({ file: row.filename, unverified: verifySpans(row.fields, row.markdown).unverified }))
      .filter((row) => row.unverified.length > 0)
    expect(failures).toEqual([])
  })

  it("checks the fields the vertical declares, not a subset", () => {
    // A structural walker can silently MISS a field, and a missed field is indistinguishable from a
    // passing one. So assert a count rather than only "no failures": six required fields, three
    // optional ones the generator always supplies except po_number, plus four per line item.
    const [first] = SET
    const report = verifySpans(first!.fields, first!.markdown)
    const expectedCount = 8 + (first!.poNumber === null ? 0 : 1) + first!.lines.length * 4
    expect(report.checked.length).toBe(expectedCount)
  })
})

describe("arithmetic fails exactly where it was made to fail", () => {
  const failing = SET.filter((row) => checkArithmetic(row.fields).failures.length > 0)
  const failingKeys = new Set(failing.map((row) => row.scenario.key))

  it("fails for arithmetic_wrong and illegal_vat_rate, and for nothing else", () => {
    // Both directions matter. A false negative means the deliberate nasties are not nasty; a false
    // positive means a clean invoice is stopped by arithmetic, which removes the only cases that
    // could reach auto_approve — and then the auto-approve gate reports zero failures because it
    // never ran. docket's harness had that exact hole: "FALSE AUTO-APPROVES 0/99 (gate never
    // exercised)".
    expect([...failingKeys].sort()).toEqual(["arithmetic_wrong", "illegal_vat_rate"])
  })

  it("names the specific sum, not just that something is wrong", () => {
    // The failure text is shown to a reviewer verbatim, so it has to say where to look.
    const report = checkArithmetic(failing.find((row) => row.scenario.key === "arithmetic_wrong")!.fields)
    expect(report.failures.some((failure) => /line items sum to/.test(failure))).toBe(true)
  })

  it("catches 13% as an illegal rate", () => {
    const report = checkArithmetic(failing.find((row) => row.scenario.key === "illegal_vat_rate")!.fields)
    expect(report.failures.some((failure) => failure.includes("13.0%"))).toBe(true)
  })

  it("leaves every clean case passing", () => {
    const clean = SET.filter((row) => row.scenario.key === "clean_under_threshold")
    for (const row of clean) expect(checkArithmetic(row.fields).failures).toEqual([])
  })
})

describe("the money formatter", () => {
  it("uses Dutch convention with both separators, which parseMoney can read unambiguously", () => {
    expect(euros(123_456)).toBe("1.234,56")
    expect(euros(62_000)).toBe("620,00")
    expect(euros(5)).toBe("0,05")
    expect(euros(100_000_000)).toBe("1.000.000,00")
  })

  it("never prints a bare thousands group, which would be ambiguous", () => {
    // `1.234` with a single separator and three trailing digits is exactly the case `parseMoney`
    // refuses, and the case a naive Number() turns into 1.234 instead of 1234. Always two decimals.
    for (const row of SET) {
      expect(row.fields.total_incl_vat.value).toMatch(/,\d{2}$/)
      expect(row.fields.vat_amount.value).toMatch(/,\d{2}$/)
    }
  })
})

describe("the scenario labels", () => {
  it("names every non-clean scenario as one that must never auto-approve", () => {
    // This set is the gate's subject. Deriving it from `expected` rather than listing it means adding
    // a scenario cannot forget to add it here.
    expect(MUST_NOT_AUTO_APPROVE.size).toBe(SCENARIOS.length - 1)
    expect(MUST_NOT_AUTO_APPROVE.has("clean_under_threshold")).toBe(false)
    expect(MUST_NOT_AUTO_APPROVE.has("duplicate_invoice")).toBe(true)
  })

  it("gives every scenario at least one dimension a correct decision must consider", () => {
    // `dimensions` is what makes a regression legible: "the currency clause stopped being retrieved"
    // is actionable, "recall fell to 0.8" is not.
    for (const scenario of SCENARIOS) expect(scenario.dimensions.length).toBeGreaterThan(0)
  })
})
