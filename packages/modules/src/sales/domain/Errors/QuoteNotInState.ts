/**
 * The quote is not in the state the transition needs: somebody else approved or sent it first, or it is not ready.
 * A fact about the quote, not a failure of the system.
 */
import { Schema } from "effect"

export class QuoteNotInState extends Schema.TaggedError<QuoteNotInState>()("QuoteNotInState", {
  quoteId: Schema.String,
  /** What the transition needs it to be. */
  expected: Schema.String
}) {}
