/**
 * The product no longer matches the proposal's "before": it was changed after the proposal was made, so applying
 * it would overwrite a change the person approving never saw. Refused; ask again for a fresh proposal.
 */
import { Schema } from "effect"

export class ChangeIsStale extends Schema.TaggedError<ChangeIsStale>()("ChangeIsStale", {
  changeId: Schema.String,
  sku: Schema.String
}) {}
