/**
 * The verbatim check, and the walker that finds the spans to check.
 *
 * The second describe block is the important one. A structural predicate can *miss* a field, and a
 * missed field is indistinguishable from a passing one — so the vertical declares its paths and this
 * asserts the walker agrees. Two independent statements of the same fact; if they diverge, one of
 * them is wrong and the test says which.
 */
import { verifySpans } from "@ea/modules/decision/domain/Extraction"
import { INVOICE_REQUIRED_FIELD_PATHS } from "@ea/modules/decision/domain/Invoice"
import { describe, expect, it } from "vitest"

const DOCUMENT = `FACTUUR 2026-041
Acme Industrieel BV
Datum: 1 september 2026

Omschrijving        Aantal   Prijs      Bedrag
Widget type A            2   300,00     600,00
Onderhoud                4   100,00     400,00

Subtotaal                                1.000,00
BTW 21%                                    210,00
Totaal incl. BTW                         1.210,00
`

const field = (span: string, value: unknown) => ({ source_span: span, value })

const invoice = {
  currency: field("BTW 21%", "EUR"),
  supplier: field("Acme Industrieel BV", "Acme Industrieel BV"),
  invoice_number: field("FACTUUR 2026-041", "2026-041"),
  issued_on: field("Datum: 1 september 2026", "2026-09-01"),
  total_incl_vat: field("Totaal incl. BTW                         1.210,00", "1.210,00"),
  vat_amount: field("BTW 21%                                    210,00", "210,00"),
  line_items: [
    {
      description: field("Widget type A", "Widget type A"),
      quantity: field("Widget type A            2", "2"),
      unit_price: field("300,00", "300,00"),
      amount: field("600,00", "600,00")
    }
  ]
}

describe("verifySpans", () => {
  it("verifies every span of a well-grounded extraction", () => {
    const report = verifySpans(invoice, DOCUMENT)
    expect(report.unverified).toEqual([])
    expect(report.checked.length).toBeGreaterThan(0)
  })

  it("names the dotted path of a span the document does not contain", () => {
    const fabricated = { ...invoice, vat_amount: field("BTW 19%  190,00", "190,00") }
    expect(verifySpans(fabricated, DOCUMENT).unverified).toEqual(["vat_amount"])
  })

  it("indexes into arrays, so a reviewer is pointed at the right line", () => {
    const fabricated = {
      ...invoice,
      line_items: [
        invoice.line_items[0]!,
        { ...invoice.line_items[0]!, amount: field("999,00", "999,00") }
      ]
    }
    expect(verifySpans(fabricated, DOCUMENT).unverified).toEqual(["line_items.1.amount"])
  })

  it("tolerates re-wrapping and case, which are not inventions", () => {
    const rewrapped = {
      ...invoice,
      supplier: field("acme   industrieel\n  bv", "Acme Industrieel BV")
    }
    expect(verifySpans(rewrapped, DOCUMENT).unverified).toEqual([])
  })

  it("does NOT tolerate altered digits or punctuation", () => {
    // The characters worth lying about. A span differing only in a decimal separator is exactly the
    // failure this check is for, so normalisation must stop short of them.
    const altered = { ...invoice, total_incl_vat: field("Totaal incl. BTW 1,210.00", "1.210,00") }
    expect(verifySpans(altered, DOCUMENT).unverified).toEqual(["total_incl_vat"])
  })

  it("treats an empty span as unverified", () => {
    // It quotes nothing, so it proves nothing. Returning true would let a blank span verify against
    // any document at all — the single most useful thing for a model to emit if it were trying to.
    const blank = { ...invoice, supplier: field("", "Acme Industrieel BV") }
    expect(verifySpans(blank, DOCUMENT).unverified).toEqual(["supplier"])
  })

  it("does not mistake a nested object for a field", () => {
    // An object carrying a source_span AND other keys is not a leaf. If it were treated as one, the
    // fields nested inside it would never be walked — and would pass by never being checked.
    const nested = {
      wrapper: {
        source_span: "not in the document at all",
        note: "extra key",
        value: 1,
        inner: field("Acme Industrieel BV", "x")
      }
    }
    const report = verifySpans(nested, DOCUMENT)
    expect(report.checked).toEqual(["wrapper.inner"])
    expect(report.unverified).toEqual([])
  })
})

describe("the walker agrees with what the vertical declares", () => {
  it("finds exactly the invoice's required field paths, plus its line items", () => {
    // The cross-check. If someone adds a field to Invoice and the walker silently skips it, this
    // fails — whereas the extraction itself would keep passing, because an unchecked field looks
    // identical to a verified one.
    const found = verifySpans(invoice, DOCUMENT).checked
    const expected = [
      ...INVOICE_REQUIRED_FIELD_PATHS,
      "line_items.0.description",
      "line_items.0.quantity",
      "line_items.0.unit_price",
      "line_items.0.amount"
    ]
    // Sets, because the assertion is about which paths exist rather than what order the
    // walker happened to visit them in.
    expect(new Set(found)).toEqual(new Set(expected))
  })
})
