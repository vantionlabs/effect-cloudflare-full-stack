/**
 * The intake refusal.
 *
 * Its own file rather than a member of `Document.model.ts` because `rg --files -g '*.errors.ts'`
 * is meant to enumerate every failure a slice can produce — the list a caller integrating against
 * the API actually needs.
 */
import { Schema } from "effect"

/**
 * A document we will not parse.
 *
 * A *typed refusal* rather than a best-effort parse, and that is the point. A scanned PDF run
 * through a text-layer extractor yields a flattened line-item table, which would leave the
 * arithmetic rail checking sums that were never really extracted — a wrong decision with a
 * perfect audit trail. Better to refuse and say why.
 */
export class UnsupportedDocument extends Schema.TaggedError<UnsupportedDocument>()(
  "UnsupportedDocument",
  {
    filename: Schema.String,
    contentType: Schema.String,
    /** What the caller can do instead. Listed so the error is actionable, not just a rejection. */
    supported: Schema.Array(Schema.String)
  }
) {}
