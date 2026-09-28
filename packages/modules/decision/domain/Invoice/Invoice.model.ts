/**
 * The supplier-invoice vertical.
 *
 * **This is the swap point.** Everything around it — extract, verify spans, check arithmetic,
 * retrieve policy, decide — knows nothing about invoices. A contract renewal or a tender is a
 * sibling file in this folder, not a fork of the pipeline.
 *
 * Two ordering decisions, both deliberate:
 *
 * 1. **`currency` is declared before any amount.** Same logic as `source_span` before `value`: the
 *    model commits to the currency before it reads figures, rather than reporting amounts and then
 *    deciding what they are denominated in.
 * 2. **Every amount is a `Schema.String`.** The digits exactly as printed, which is also what
 *    `source_span` quotes. Coercing to a number inside the model's output would put a silent
 *    reformatting between the document and the check — `1.234,56` arriving as `1.234` is a wrong
 *    decision with a perfect audit trail. `parseMoney` does the conversion, and refuses on
 *    ambiguity.
 */
import { Currency } from "@ea/modules/shared/domain/Money"
import { Schema } from "effect"
import { ExtractedField } from "../Extraction/Extraction.model.ts"

/** The vertical's identifier, used to look up its schema and its declared field paths. */
export const INVOICE = "invoice"

const Amount = ExtractedField(
  Schema.String.annotate({
    description: "The amount exactly as printed, including its thousands and decimal separators. " +
      "Do not reformat it and do not convert it to a plain number."
  })
)

export const LineItem = Schema.Struct({
  description: ExtractedField(Schema.String),
  quantity: ExtractedField(
    Schema.String.annotate({ description: "The quantity exactly as printed." })
  ),
  unit_price: Amount,
  amount: Amount.annotate({ description: "Line total excluding VAT, exactly as printed." })
})
export type LineItem = typeof LineItem.Type

export const Invoice = Schema.Struct({
  // Currency first: the model settles what the figures are denominated in before reading any.
  currency: ExtractedField(Currency.annotate({ description: "ISO 4217 code, e.g. EUR." })),
  supplier: ExtractedField(Schema.String),
  invoice_number: ExtractedField(Schema.String),
  issued_on: ExtractedField(
    Schema.String.annotate({ description: "The issue date exactly as printed on the document." })
  ),
  total_incl_vat: Amount,
  vat_amount: Amount,
  due_on: Schema.optional(ExtractedField(Schema.String)),
  po_number: Schema.optional(ExtractedField(Schema.String)),
  cost_centre: Schema.optional(ExtractedField(Schema.String)),
  line_items: Schema.Array(LineItem)
})
export type Invoice = typeof Invoice.Type

/**
 * Every span-bearing path this schema declares, for the required fields.
 *
 * Asserted against `verifySpans`'s own walk in a test. The point is that this list and the walker are
 * **two independent statements of the same fact**: the walker recognises fields structurally and can
 * therefore silently miss one whose shape drifts, and a missed field looks exactly like a passing
 * one. Deriving this from the schema AST was considered and rejected — it would share the bug.
 *
 * Optional fields and line items are absent because they depend on the document; the test adds them
 * for the fixture it uses.
 */
export const INVOICE_REQUIRED_FIELD_PATHS: ReadonlyArray<string> = [
  "currency",
  "supplier",
  "invoice_number",
  "issued_on",
  "total_incl_vat",
  "vat_amount"
]
