/** Payment terms the sales slice refuses: not a plausible email, or a number of days outside 0–365. */
import { Schema } from "effect"

export class InvalidTerms extends Schema.TaggedError<InvalidTerms>()("InvalidTerms", {
  reason: Schema.String
}) {}
