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
import { ExtractedField } from "../Extraction/Extraction.ts"

/** The vertical's identifier, used to look up its schema and its declared field paths. */
export const INVOICE = "invoice"

const Amount = ExtractedField(
  Schema.String.annotate({
    // "Exactly as printed" alone was read by a real model as "copy the whole printed line", label and
    // markdown included — so the digits are now described by what they EXCLUDE as well.
    description: "The digits of the amount and nothing else: no currency code, no label, no colon and " +
      "no markdown characters. Keep the thousands and decimal separators exactly as printed and do not " +
      "convert it to a plain number — `1.234,56` stays `1.234,56`."
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
  /*
   * Optional, and each one carries a description telling the model to extract it WHEN PRESENT.
   *
   * These had no descriptions, and a real model treated "optional" as "skip". The consequence is not a
   * missing field but a wrong decision: `evaluateRule` treats an absent due date as "the payment term
   * cannot be shown to hold" and an absent PO as "the invoice states none", so a clean invoice with a
   * PO and thirty-day terms was routed to a human for breaching bounds it actually met. Measured at
   * `payment_terms` firing on 50% of cases and `purchase_order` on 30%, all of them false.
   */
  due_on: Schema.optional(ExtractedField(
    Schema.String.annotate({
      description: "The due or payment date exactly as printed. Extract it whenever the document shows " +
        "one, under any label (Vervaldatum, Due date, Te betalen voor). Omit it ONLY if the document " +
        "states no due date at all."
    })
  )),
  po_number: Schema.optional(ExtractedField(
    Schema.String.annotate({
      description: "The purchase order number exactly as printed. Extract it whenever the document " +
        "shows one, under any label (Inkoopordernummer, Inkooporder, PO, Purchase order). Omit it ONLY " +
        "if the document shows no purchase order number at all — whether one is present decides whether " +
        "the invoice can be approved."
    })
  )),
  cost_centre: Schema.optional(ExtractedField(
    Schema.String.annotate({
      description: "The cost centre exactly as printed (Kostenplaats), when the document shows one."
    })
  )),
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
