/**
 * Rule evaluation, and the date parser it depends on.
 *
 * This is the object that authorises paying a supplier with no human involved, so the tests are written
 * around the ways it could be too permissive rather than around its happy path. The one that matters
 * most is the group at the bottom: **unreadable must be unmet.** A check that skips itself when its
 * input is missing is how an invoice with an unparseable total walks past a ceiling, and it looks
 * identical to a check that passed.
 */
import { invoiceRuleFacts, parsePrintedDate } from "@ea/modules/decision/domain/Invoice"
import { AutoApproveRule, evaluateRule, type RuleFacts } from "@ea/modules/decision/domain/Rule"
import { describe, expect, it } from "vitest"

const rule = (overrides: Partial<AutoApproveRule> = {}) =>
  new AutoApproveRule({
    id: "rule_1",
    vertical: "invoice",
    armed: true,
    max_amount_minor: 100_000,
    currency: "EUR",
    require_po: true,
    approved_suppliers: ["Contoso Cleaning Services BV", "Fabrikam Office Supplies BV"],
    min_payment_days: 14,
    description: "test",
    ...overrides
  })

const facts = (overrides: Partial<RuleFacts> = {}): RuleFacts => ({
  totalMinor: 85_000,
  currency: "EUR",
  supplier: "Contoso Cleaning Services BV",
  poNumber: "PO-2026-0001",
  paymentDays: 30,
  ...overrides
})

describe("the bound that holds", () => {
  it("returns no reasons when every condition is met", () => {
    // Worth asserting first: an evaluator that refused everything would pass every other test here.
    expect(evaluateRule(rule(), facts())).toEqual([])
  })

  it("treats null bounds as genuinely unbounded", () => {
    const unbounded = rule({
      max_amount_minor: null,
      require_po: false,
      approved_suppliers: [],
      min_payment_days: 0
    })
    expect(evaluateRule(unbounded, facts({ totalMinor: 9_999_999, poNumber: null, paymentDays: 1 })))
      .toEqual([])
  })
})

describe("armed", () => {
  it("refuses a draft, and says it is a draft", () => {
    const reasons = evaluateRule(rule({ armed: false }), facts())
    expect(reasons.length).toBe(1)
    expect(reasons[0]).toContain("draft")
  })

  it("short-circuits: a draft reports being a draft, not every bound it also breaches", () => {
    // "This rule is not armed" is the actionable fact. Listing five breached bounds underneath it would
    // bury it, and none of them matter until somebody arms the rule.
    expect(evaluateRule(rule({ armed: false }), facts({ totalMinor: 9_999_999, poNumber: null }))).toHaveLength(1)
  })
})

describe("the ceiling", () => {
  it("refuses an amount above it, naming both figures", () => {
    const reasons = evaluateRule(rule(), facts({ totalMinor: 800_000 }))
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain("EUR 8.000,00")
    expect(reasons[0]).toContain("EUR 1.000,00")
  })

  it("allows exactly the ceiling, because a limit of EUR 1.000 means EUR 1.000 is allowed", () => {
    // Off-by-one on a payment authorisation is worth a test of its own. `>` not `>=`.
    expect(evaluateRule(rule(), facts({ totalMinor: 100_000 }))).toEqual([])
  })

  it("refuses one cent over", () => {
    expect(evaluateRule(rule(), facts({ totalMinor: 100_001 }))).toHaveLength(1)
  })
})

describe("currency", () => {
  it("refuses a different currency even when the number is under the ceiling", () => {
    /*
     * THE reason currency is checked before the ceiling. USD 850 is "under 100000 minor units" as a
     * number, and it is not what a EUR 1.000 authorisation authorised. A ceiling without a currency is
     * a number without a unit.
     */
    const reasons = evaluateRule(rule(), facts({ currency: "USD" }))
    expect(reasons.some((reason) => reason.startsWith("currency:"))).toBe(true)
  })
})

describe("purchase order", () => {
  it("refuses an absent PO when the rule requires one", () => {
    expect(evaluateRule(rule(), facts({ poNumber: null }))[0]).toContain("purchase_order")
  })

  it("refuses a whitespace-only PO, which is an absent one wearing a disguise", () => {
    expect(evaluateRule(rule(), facts({ poNumber: "   " }))).toHaveLength(1)
  })
})

describe("the approved supplier list", () => {
  it("refuses a supplier that is not on it", () => {
    const reasons = evaluateRule(rule(), facts({ supplier: "Litware Consulting Group BV" }))
    expect(reasons[0]).toContain("Litware Consulting Group BV")
  })

  it("matches case-insensitively and tolerates stray whitespace", () => {
    // The list is maintained by a human in a spreadsheet. "Contoso Cleaning Services BV " is the same
    // company; refusing it would produce an escalation nobody can explain.
    expect(evaluateRule(rule(), facts({ supplier: "  contoso   cleaning services bv " }))).toEqual([])
  })

  it("does not match on a prefix, because a different legal entity is a different entity", () => {
    // "Contoso Cleaning" is not "Contoso Cleaning Services BV", and a fraudster registering the former
    // is a known pattern. Exact match after normalisation, never `includes`.
    expect(evaluateRule(rule(), facts({ supplier: "Contoso Cleaning" }))).toHaveLength(1)
  })
})

describe("payment terms", () => {
  it("refuses a term shorter than the minimum", () => {
    const reasons = evaluateRule(rule(), facts({ paymentDays: 7 }))
    expect(reasons[0]).toContain("7 days")
    expect(reasons[0]).toContain("14")
  })

  it("allows exactly the minimum", () => {
    expect(evaluateRule(rule(), facts({ paymentDays: 14 }))).toEqual([])
  })
})

describe("unreadable is unmet, for every bound that has an input", () => {
  it("refuses when the total could not be parsed", () => {
    const reasons = evaluateRule(rule(), facts({ totalMinor: null }))
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain("could not be read")
  })

  it("refuses when the payment term could not be determined", () => {
    const reasons = evaluateRule(rule(), facts({ paymentDays: null }))
    expect(reasons[0]).toContain("could not be determined")
  })

  it("does NOT refuse an unreadable input for a bound that is unbounded", () => {
    // The asymmetry is deliberate. If nobody set a ceiling, being unable to read the total is not a
    // reason to refuse — it is a reason for rail 1 to fire, which it does, from a different input.
    expect(evaluateRule(rule({ max_amount_minor: null }), facts({ totalMinor: null }))).toEqual([])
  })

  it("reports every unmet bound, not just the first", () => {
    // A reviewer who fixes one reason and resubmits should not discover a second one afterwards.
    const reasons = evaluateRule(
      rule(),
      facts({
        totalMinor: 900_000,
        currency: "USD",
        poNumber: null,
        supplier: "Litware Consulting Group BV",
        paymentDays: 3
      })
    )
    expect(reasons).toHaveLength(5)
  })
})

describe("parsePrintedDate", () => {
  it("reads ISO, Dutch long form, and day-first numeric", () => {
    expect(parsePrintedDate("2026-02-12")?.toISOString()).toBe("2026-02-12T00:00:00.000Z")
    expect(parsePrintedDate("12 februari 2026")?.toISOString()).toBe("2026-02-12T00:00:00.000Z")
    expect(parsePrintedDate("12-02-2026")?.toISOString()).toBe("2026-02-12T00:00:00.000Z")
    expect(parsePrintedDate("12.02.2026")?.toISOString()).toBe("2026-02-12T00:00:00.000Z")
  })

  it("reads abbreviated Dutch months, with or without a full stop", () => {
    expect(parsePrintedDate("3 mrt 2026")?.toISOString()).toBe("2026-03-03T00:00:00.000Z")
    expect(parsePrintedDate("3 mrt. 2026")?.toISOString()).toBe("2026-03-03T00:00:00.000Z")
  })

  it("REFUSES a slash-separated date, because nobody knows which convention it uses", () => {
    /*
     * The most important case in this file. `03/04/2026` is 3 April in the Netherlands and 4 March in
     * the United States, and the invoice does not say which its author meant. A date read wrongly by a
     * month is worse than one not read at all: the second escalates, the first silently changes whether
     * a payment term was 30 days or 61.
     */
    expect(parsePrintedDate("03/04/2026")).toBeNull()
  })

  it("refuses anything it does not recognise, rather than guessing", () => {
    // No `new Date(text)` fallback. Date's own parser accepts nearly anything and invents the rest.
    for (const text of ["next Tuesday", "Feb 2026", "", "202-02-12", "12 Februar 2026", "32-01-2026"]) {
      expect(parsePrintedDate(text), text).toBeNull()
    }
  })

  it("refuses an impossible month", () => {
    expect(parsePrintedDate("12-13-2026")).toBeNull()
  })

  it("refuses a day that does not exist in its month, rather than rolling over", () => {
    /*
     * `Date.UTC` rolls over silently, and this is where that was found: `32-01-2026` became 1 February
     * and parsed as a perfectly good date. 29 February 2027 is the same bug with a calendar attached —
     * it becomes 1 March. Both are caught by round-tripping the components rather than range-checking.
     */
    expect(parsePrintedDate("32-01-2026")).toBeNull()
    expect(parsePrintedDate("29-02-2027")).toBeNull()
    expect(parsePrintedDate("31 april 2026")).toBeNull()
    // 2028 is a leap year, so this one is real and must still parse.
    expect(parsePrintedDate("29-02-2028")?.toISOString()).toBe("2028-02-29T00:00:00.000Z")
  })
})

describe("invoiceRuleFacts", () => {
  const invoice = {
    currency: { value: "EUR", source_span: "EUR" },
    supplier: { value: "Contoso Cleaning Services BV", source_span: "Contoso Cleaning Services BV" },
    invoice_number: { value: "CCS-1", source_span: "CCS-1" },
    issued_on: { value: "12 februari 2026", source_span: "12 februari 2026" },
    total_incl_vat: { value: "1.234,56", source_span: "1.234,56" },
    vat_amount: { value: "214,22", source_span: "214,22" },
    due_on: { value: "14 maart 2026", source_span: "14 maart 2026" },
    po_number: { value: "PO-1", source_span: "PO-1" },
    line_items: []
  } as never

  it("reads Dutch amounts into integer minor units", () => {
    // `1.234,56` is 123456 cents. A naive Number() reads it as 1.234 — the wrong decision with a
    // perfect audit trail, which is the failure `parseMoney` exists to prevent.
    expect(invoiceRuleFacts(invoice).totalMinor).toBe(123_456)
  })

  it("computes the payment term from the two printed dates", () => {
    expect(invoiceRuleFacts(invoice).paymentDays).toBe(30)
  })

  it("returns null for the payment term when the due date is absent", () => {
    const { due_on: _omitted, ...rest } = invoice as unknown as Record<string, unknown>
    expect(invoiceRuleFacts(rest as never).paymentDays).toBeNull()
  })

  it("returns null rather than a negative term when the due date precedes the issue date", () => {
    // Not a short payment term — a document we cannot read. The distinction matters because the first
    // is a fraud signal and the second is an extraction problem.
    const reversed = { ...invoice as object, due_on: { value: "1 januari 2026", source_span: "x" } }
    expect(invoiceRuleFacts(reversed as never).paymentDays).toBeNull()
  })
})
