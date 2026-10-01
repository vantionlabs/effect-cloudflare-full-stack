/** Payment was already recorded for this invoice. */
import { Schema } from "effect"

export class InvoiceAlreadyPaid extends Schema.TaggedError<InvoiceAlreadyPaid>()("InvoiceAlreadyPaid", {
  invoiceId: Schema.String
}) {}
