/** A product the price list refuses: an unknown VAT rate, a negative price, an empty SKU or name. */
import { Schema } from "effect"

export class InvalidProduct extends Schema.TaggedError<InvalidProduct>()("InvalidProduct", {
  reason: Schema.String
}) {}
