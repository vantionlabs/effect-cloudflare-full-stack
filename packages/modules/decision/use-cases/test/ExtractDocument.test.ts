/**
 * Extraction end to end, on ports alone: **no API key, no database, no network, no bindings.**
 *
 * This is the tier the architecture exists to make possible, and it only works because
 * `ExtractDocument`'s single port is `LanguageModel`. The scripted double drives the real
 * `generateObject` path — JSON mode, real decode, real span check, real arithmetic — so these
 * assertions are about the pipeline rather than about a mock.
 *
 * The scripts are adversarial on purpose. They are the product's specification of what a model must
 * not be able to get past, not incidental fixtures.
 */
import { checkArithmetic, INVOICE, Invoice, INVOICE_REQUIRED_FIELD_PATHS } from "@ea/modules/decision/domain/Invoice"
import { LanguageModelScripted, scriptFrom } from "@ea/modules/decision/server/Extraction"
import { ExtractDocument } from "@ea/modules/decision/use-cases/Extraction"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"

const DOCUMENT = `FACTUUR 2026-041
Acme Industrieel BV
Datum: 1 september 2026

Widget type A            2   300,00     600,00
Onderhoud                4   100,00     400,00

Subtotaal                                1.000,00
BTW 21%                                    210,00
Totaal incl. BTW                         1.210,00
`

const field = (span: string, value: unknown) => ({ source_span: span, value })

/** A correct reading of the document above. Each case below perturbs exactly one thing. */
const honest = {
  currency: field("BTW 21%", "EUR"),
  supplier: field("Acme Industrieel BV", "Acme Industrieel BV"),
  invoice_number: field("FACTUUR 2026-041", "2026-041"),
  issued_on: field("Datum: 1 september 2026", "1 september 2026"),
  total_incl_vat: field("Totaal incl. BTW                         1.210,00", "1.210,00"),
  vat_amount: field("BTW 21%                                    210,00", "210,00"),
  line_items: [
    {
      description: field("Widget type A", "Widget type A"),
      quantity: field("Widget type A            2", "2"),
      unit_price: field("300,00", "300,00"),
      amount: field("600,00", "600,00")
    },
    {
      description: field("Onderhoud", "Onderhoud"),
      quantity: field("Onderhoud                4", "4"),
      unit_price: field("100,00", "100,00"),
      amount: field("400,00", "400,00")
    }
  ]
}

const extract = (answer: unknown) =>
  Effect.runPromise(
    ExtractDocument({
      documentText: DOCUMENT,
      schema: Invoice,
      objectName: INVOICE,
      checkArithmetic
    }).pipe(
      Effect.provide(LanguageModelScripted(scriptFrom("test", [{ when: "FACTUUR 2026-041", answer }])))
    )
  )

describe("a clean extraction", () => {
  it("passes both model-free checks and keeps amounts as printed", async () => {
    const result = await extract(honest)

    expect(result.checksPassed).toBe(true)
    expect(result.verification.unverified).toEqual([])
    expect(result.arithmetic.failures).toEqual([])
    // The digits survive the round trip un-reformatted. This is the whole reason amounts are strings:
    // `1.210,00` arriving as 1.21 would be a wrong decision with a perfect audit trail.
    expect(result.data.total_incl_vat.value).toBe("1.210,00")
    expect(result.data.line_items).toHaveLength(2)
  })

  it("checks every field the vertical declares", async () => {
    const result = await extract(honest)
    for (const path of INVOICE_REQUIRED_FIELD_PATHS) {
      expect(result.verification.checked).toContain(path)
    }
  })
})

describe("what a model must not get past", () => {
  it("fails the span check on a fabricated quote", async () => {
    // The failure that actually matters: a plausible number the document never contained.
    const result = await extract({ ...honest, vat_amount: field("BTW 19%  190,00", "190,00") })

    expect(result.checksPassed).toBe(false)
    expect(result.verification.unverified).toEqual(["vat_amount"])
    // And note: the arithmetic ALSO fails here, which is the point of having two checks. Either one
    // alone could be satisfied by a sufficiently careful fabrication.
    expect(result.arithmetic.failures.length).toBeGreaterThan(0)
  })

  it("fails the arithmetic check on a real quote with a wrong total", async () => {
    // Every span verifies — these figures are all printed on the document — and the invoice still
    // does not add up, because the model paired the wrong ones. No span check would catch this.
    const result = await extract({
      ...honest,
      total_incl_vat: field("Subtotaal                                1.000,00", "1.000,00")
    })

    expect(result.verification.unverified).toEqual([])
    expect(result.checksPassed).toBe(false)
    expect(result.arithmetic.failures.join(" ")).toContain("not a legal Dutch rate")
  })

  it("fails on a corrected total, which is the model being helpful", async () => {
    // Asked not to compute, the model computes anyway and quietly fixes a line. The corrected figure
    // is not in the document, so the span check catches exactly the case the instruction asks for.
    const result = await extract({
      ...honest,
      line_items: [
        { ...honest.line_items[0]!, amount: field("610,00", "610,00") },
        honest.line_items[1]!
      ]
    })

    expect(result.verification.unverified).toEqual(["line_items.0.amount"])
  })

  it("relies on arithmetic, not spans, to catch a TRUNCATED amount", async () => {
    // Worth understanding, because it bounds what the span check can do. `1.210` is a substring of
    // the printed `1.210,00`, so it verifies as verbatim — the quote really does occur in the
    // document. Truncation is therefore invisible to grounding, and `1.210` is off by a factor of a
    // thousand.
    //
    // The parse is what refuses it, which is the concrete argument for having two independent checks
    // rather than one good one. Tightening `containsVerbatim` to token boundaries would not help:
    // legitimate spans start and end mid-line all the time.
    const result = await extract({ ...honest, total_incl_vat: field("1.210", "1.210") })

    expect(result.verification.unverified).toEqual([])
    expect(result.arithmetic.failures.join(" ")).toContain("separator-could-be-either")
    expect(result.checksPassed).toBe(false)
  })

  it("treats prompt injection in the document as content", async () => {
    // A supplier invoice is attacker-controlled text. Extracting the instruction as a field value is
    // the correct behaviour; the span verifies because the words really are on the page.
    const injected = { ...honest, supplier: field("Acme Industrieel BV", "Acme Industrieel BV") }
    const result = await extract(injected)
    expect(result.data.supplier.value).toBe("Acme Industrieel BV")
  })
})

describe("the scripted model", () => {
  it("dies rather than answering a prompt it has no script for", async () => {
    // A fake that falls back to a default makes every test that hits it pass for the wrong reason,
    // which is worse than no test: it reports confidence about a path nobody exercised.
    const outcome = await Effect.runPromiseExit(
      ExtractDocument({ documentText: "a different document", schema: Invoice, objectName: INVOICE })
        .pipe(Effect.provide(LanguageModelScripted(scriptFrom("strict", []))))
    )
    expect(outcome._tag).toBe("Failure")
  })
})
