/** No quote with that id in the caller's organization — which is also the answer for another tenant's id. */
import { Schema } from "effect"

export class QuoteNotFound extends Schema.TaggedError<QuoteNotFound>()("QuoteNotFound", {
  quoteId: Schema.String
}) {}
