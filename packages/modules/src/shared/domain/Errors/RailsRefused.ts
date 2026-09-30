/**
 * The rails refused to let this proceed automatically. **Terminal, and not an error condition.**
 *
 * It means the product worked: a human is now looking at it. Retrying would re-run the model to reach the
 * same refusal, because the rails are a pure function of the same inputs — which is the specific waste the
 * terminal classification exists to prevent.
 */
import { Schema } from "effect"

export class RailsRefused extends Schema.TaggedError<RailsRefused>()("RailsRefused", {
  decisionId: Schema.String,
  outcome: Schema.String
}) {}
