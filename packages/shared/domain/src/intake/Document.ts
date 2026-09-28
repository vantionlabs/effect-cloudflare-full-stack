/**
 * Documents and the parsing contract.
 *
 * The `DocumentParser` port lives in the domain package, which is unusual for a port — but
 * markdown and plain text need no platform at all, so the *default* implementation is pure and
 * belongs here. Later adapters (the `anydoc` WASM module, Mistral OCR) satisfy the same interface
 * from the Worker without any caller changing.
 */
import { Schema } from "effect"

export const DocumentId = Schema.String.pipe(Schema.brand("DocumentId"))
export type DocumentId = typeof DocumentId.Type

export const IntakeId = Schema.String.pipe(Schema.brand("IntakeId"))
export type IntakeId = typeof IntakeId.Type

/**
 * Which corpus a document belongs to.
 *
 * The separation is the product's most important structural guarantee: the policy corpus is what
 * decisions are justified *against*, and a transactional document must never be citable as
 * policy. Enforced by a CHECK constraint plus a filter inside the retrieval function, so it
 * cannot be forgotten at a call site.
 */
export const Collection = Schema.Literals(["policy", "transactional"])
export type Collection = typeof Collection.Type

export const DocumentStatus = Schema.Literals([
  "pending_upload",
  "uploaded",
  "processing",
  "ready",
  "failed"
])
export type DocumentStatus = typeof DocumentStatus.Type

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

/** What a parser produces: markdown, plus whatever provenance the parser could establish. */
export class ParsedDocument extends Schema.Class<ParsedDocument>("ParsedDocument")({
  /**
   * The text every `source_span` is checked against. Stored with the extraction so the verbatim
   * claim is re-checkable a year later against the same bytes the check originally ran on.
   */
  text: Schema.String,
  /** Null when the format has no pages (markdown, plain text). */
  pageCount: Schema.NullOr(Schema.Int)
}) {}
