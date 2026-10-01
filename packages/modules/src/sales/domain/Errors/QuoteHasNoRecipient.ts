/** An approved quote with no customer email — sending needs an address that came from the request. */
import { Schema } from "effect"

export class QuoteHasNoRecipient extends Schema.TaggedError<QuoteHasNoRecipient>()("QuoteHasNoRecipient", {
  quoteId: Schema.String
}) {}
