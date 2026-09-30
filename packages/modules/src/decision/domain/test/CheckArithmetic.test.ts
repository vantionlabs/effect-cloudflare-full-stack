/**
 * The arithmetic check, exercised on the failures it exists to catch.
 *
 * Note what every case asserts: a *named* failure. "The invoice is wrong" is useless to a reviewer;
 * "line 2: 3 × 12,50 is 37.5, but the line reads 375" tells them where to look. The check's output is
 * read by a human, so its wording is part of its behaviour.
 */
import { checkArithmetic } from "@ea/modules/decision/domain/Invoice"
import { describe, expect, it } from "vitest"

/** Builds a field. Provenance is irrelevant to arithmetic, so the span is just the printed text. */
const field = <A>(value: A, span?: string) => ({ source_span: span ?? String(value), value })

const invoice = (options: {
  readonly total: string
  readonly vat: string
  readonly lines?: ReadonlyArray<{ quantity: string; unitPrice: string; amount: string }>
  readonly currency?: "EUR" | "USD"
}) => ({
  currency: field(options.currency ?? ("EUR" as const)),
  supplier: field("Acme BV"),
  invoice_number: field("2026-041"),
  issued_on: field("2026-09-01"),
  total_incl_vat: field(options.total),
  vat_amount: field(options.vat),
  line_items: (options.lines ?? []).map((line) => ({
    description: field("Widget"),
    quantity: field(line.quantity),
    unit_price: field(line.unitPrice),
    amount: field(line.amount)
  }))
})

describe("a consistent invoice", () => {
  it("passes with 21% VAT and lines that sum", () => {
    const report = checkArithmetic(invoice({
      total: "1.210,00",
      vat: "210,00",
      lines: [
        { quantity: "2", unitPrice: "300,00", amount: "600,00" },
        { quantity: "4", unitPrice: "100,00", amount: "400,00" }
      ]
    }))
    expect(report.failures).toEqual([])
  })

  it("passes with 9% VAT and a fractional quantity", () => {
    // 1,5 × 200,00 = 300,00. The thousandths scale is what keeps this exact.
    const report = checkArithmetic(invoice({
      total: "327,00",
      vat: "27,00",
      lines: [{ quantity: "1,5", unitPrice: "200,00", amount: "300,00" }]
    }))
    expect(report.failures).toEqual([])
  })

  it("tolerates a cent of per-line rounding drift", () => {
    // Invoices round per line, so a cent or two on a multi-line total is normal.
    const report = checkArithmetic(invoice({
      total: "1.210,01",
      vat: "210,00",
      lines: [{ quantity: "1", unitPrice: "1.000,01", amount: "1.000,00" }]
    }))
    expect(report.failures).toEqual([])
  })
})

describe("failures worth catching", () => {
  it("names a line whose quantity times price is not its amount", () => {
    const report = checkArithmetic(invoice({
      total: "1.210,00",
      vat: "210,00",
      lines: [{ quantity: "3", unitPrice: "12,50", amount: "1.000,00" }]
    }))
    expect(report.failures.some((failure) => failure.startsWith("line 1:"))).toBe(true)
    expect(report.failures.join(" ")).toContain("37.5")
  })

  it("names a line total that does not reconcile to the subtotal", () => {
    const report = checkArithmetic(invoice({
      total: "1.210,00",
      vat: "210,00",
      lines: [{ quantity: "1", unitPrice: "500,00", amount: "500,00" }]
    }))
    expect(report.failures.join(" ")).toContain("line items sum to 500")
  })

  it("rejects a VAT rate that is not legal in the Netherlands", () => {
    // 13% — the docket adversarial case. Plausible-looking and not a real rate.
    const report = checkArithmetic(invoice({ total: "1.130,00", vat: "130,00" }))
    expect(report.failures.join(" ")).toContain("13.0%")
    expect(report.failures.join(" ")).toContain("not a legal Dutch rate")
  })

  it("catches VAT exceeding the total", () => {
    const report = checkArithmetic(invoice({ total: "100,00", vat: "200,00" }))
    expect(report.failures.join(" ")).toContain("exceeds the total")
  })

  it("catches VAT on a zero subtotal", () => {
    const report = checkArithmetic(invoice({ total: "21,00", vat: "21,00" }))
    expect(report.failures.join(" ")).toContain("subtotal of zero")
  })

  it("treats an unreadable amount as a reason for a human, not as a zero", () => {
    // `1.234` is ambiguous. Coercing it — which parseFloat would do, to 1.234 — produces an
    // internally consistent invoice for a thousandth of the real value. The check must refuse.
    const report = checkArithmetic(invoice({ total: "1.234", vat: "210,00" }))
    expect(report.failures.join(" ")).toContain("cannot be read as an amount")
    expect(report.failures.join(" ")).toContain("separator-could-be-either")
  })

  it("stops at the totals when they cannot be read, rather than reporting noise", () => {
    // One named failure the reviewer can act on beats five derived from a figure we never read.
    const report = checkArithmetic(invoice({
      total: "n/a",
      vat: "210,00",
      lines: [{ quantity: "1", unitPrice: "1,00", amount: "9.999,00" }]
    }))
    expect(report.failures).toHaveLength(1)
  })
})

describe("the exactness the integer scales buy", () => {
  it("gets 0,1 + 0,2 right, which floats do not", () => {
    // 0,10 + 0,20 = 0,30 exactly. In cents that is 10 + 20 = 30, with nothing to round.
    const report = checkArithmetic(invoice({
      total: "0,30",
      vat: "0,00",
      lines: [
        { quantity: "1", unitPrice: "0,10", amount: "0,10" },
        { quantity: "1", unitPrice: "0,20", amount: "0,20" }
      ]
    }))
    expect(report.failures).toEqual([])
  })

  it("computes 21% on an awkward subtotal without drift", () => {
    // 0,21 × 1.234,57 = 259,26 (rounded). A float pipeline lands a cent out often enough to matter.
    const report = checkArithmetic(invoice({ total: "1.493,83", vat: "259,26" }))
    expect(report.failures).toEqual([])
  })
})
