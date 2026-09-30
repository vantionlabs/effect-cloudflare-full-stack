/**
 * An embedder returned vectors of a width the column cannot hold. Raised **before any write**.
 *
 * A mismatched vector in a fixed-width column is a corrupt corpus, and changing the embedding model is a
 * data migration rather than a config change (docs/runbooks/ReEmbed.md) — so this refuses rather than
 * truncating or padding, either of which would leave a corpus that retrieves plausibly and wrongly.
 *
 * Lives in `domain/Errors` rather than beside the use case that raises it, because it is part of the slice's
 * contract: whoever writes an embedder adapter needs to know it exists.
 */
import { Schema } from "effect"

export class EmbeddingWidthMismatch extends Schema.TaggedError<EmbeddingWidthMismatch>()(
  "EmbeddingWidthMismatch",
  { modelId: Schema.String, expected: Schema.Int, actual: Schema.Int }
) {}
