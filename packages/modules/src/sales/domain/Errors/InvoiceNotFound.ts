/** No invoice with that id in the caller's organization. */
import { Schema } from "effect"

export class InvoiceNotFound extends Schema.TaggedError<InvoiceNotFound>()("InvoiceNotFound", {
  invoiceId: Schema.String
}) {}
