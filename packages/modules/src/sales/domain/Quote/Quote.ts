/**
 * A quote and its lifecycle. **Only a person moves it forward.**
 *
 *   draft ──approve──▶ approved ──send──▶ sent ──customer accepts──▶ accepted (a job is created)
 *     └─────discard──▶ discarded           └──customer declines──▶ declined
 *
 * The model writes drafts and nothing else. Approving records who approved; sending requires an approved quote
 * and a customer email that came from the request. Each transition is a compare-and-swap on the status, so two
 * tabs approving at once produce one approval, and nothing can be sent that was not approved — the same shape
 * as a decision's human boundary.
 */
import { Cents, Milli, PerMille } from "@ea/modules/shared/domain/Money"
import { Schema } from "effect"
import { ProductId, Unit, UNIT_LABEL } from "../Product/Product.ts"

export const QuoteId = Schema.String.pipe(Schema.brand("QuoteId"))
export type QuoteId = typeof QuoteId.Type

export const QuoteStatus = Schema.Literals(["draft", "approved", "sent", "discarded", "accepted", "declined"])
export type QuoteStatus = typeof QuoteStatus.Type

export class QuoteLine extends Schema.Class<QuoteLine>("QuoteLine")({
  productId: ProductId,
  sku: Schema.String,
  description: Schema.String,
  requestText: Schema.String,
  quantity: Milli,
  unit: Unit,
  unitPrice: Cents,
  vat: PerMille,
  lineTotal: Cents
}) {}

export class Quote extends Schema.Class<Quote>("Quote")({
  id: QuoteId,
  status: QuoteStatus,
  customerName: Schema.NullOr(Schema.String),
  customerEmail: Schema.NullOr(Schema.String),
  /** The customer's request, as received — what every line and flag refers back to. */
  request: Schema.String,
  lines: Schema.Array(QuoteLine),
  subtotal: Cents,
  vatTotal: Cents,
  total: Cents,
  flags: Schema.Array(Schema.String),
  createdAt: Schema.String,
  approvedBy: Schema.NullOr(Schema.String),
  sentAt: Schema.NullOr(Schema.String)
}) {}

/**
 * The quote as the customer receives it, in Dutch — the customers are Dutch businesses (PRODUCT.md). Plain text, for
 * the `Email` port; amounts formatted from integer cents.
 */
export const renderQuoteEmail = (
  organizationName: string,
  quote: Quote
): { readonly subject: string; readonly text: string } => {
  const euro = (cents: number) =>
    `€ ${(cents / 100).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const qty = (milli: number) => (milli / 1000).toLocaleString("nl-NL", { maximumFractionDigits: 3 })
  const lines = quote.lines.map((line) =>
    `${qty(line.quantity)} ${UNIT_LABEL[line.unit]} × ${line.description} (${line.sku}) à ${euro(line.unitPrice)} = ${
      euro(line.lineTotal)
    }`
  )
  return {
    subject: `Offerte van ${organizationName}`,
    text: [
      quote.customerName === null ? "Goedendag," : `Beste ${quote.customerName},`,
      "",
      `Dank voor uw aanvraag. Hierbij onze offerte:`,
      "",
      ...lines,
      "",
      `Subtotaal:  ${euro(quote.subtotal)}`,
      `Btw:        ${euro(quote.vatTotal)}`,
      `Totaal:     ${euro(quote.total)}`,
      "",
      `Met vriendelijke groet,`,
      organizationName
    ].join("\n")
  }
}
