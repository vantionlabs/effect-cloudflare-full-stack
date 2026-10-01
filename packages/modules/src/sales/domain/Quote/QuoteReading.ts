/**
 * What the model returns when it reads a customer's request: WHERE in the request each thing is, and which
 * catalogue product it thinks fits. Nothing else — no price, no total, no VAT.
 *
 * **Spans before choices, deliberately.** Every field the model fills from the request is a verbatim quote of it
 * (`request_text`, `quantity_text`, the customer fields), declared before the `sku` it chooses. The decide
 * pipeline measured why field order matters: writing the conclusion first and justifying it afterwards is what
 * produced ungrounded output. Here the model has to point at the words before it is allowed to interpret them, and
 * `priceQuote` then checks every one of those quotes against the request text.
 */
import { Schema } from "effect"

export const QuoteReading = Schema.Struct({
  /** The customer's name exactly as the request writes it, or null when it does not. */
  customer_name: Schema.NullOr(Schema.String),
  /** The customer's email exactly as written, or null. Only an email that appears in the request is ever used. */
  customer_email: Schema.NullOr(Schema.String),
  items: Schema.Array(Schema.Struct({
    /** The words in the request that ask for this item, copied exactly. */
    request_text: Schema.String,
    /** The quantity exactly as written in the request ("3", "2,5"). */
    quantity_text: Schema.String,
    /** The catalogue SKU that fits, chosen from the list given — or null when nothing in the catalogue fits. */
    sku: Schema.NullOr(Schema.String)
  }))
})
export type QuoteReading = typeof QuoteReading.Type
