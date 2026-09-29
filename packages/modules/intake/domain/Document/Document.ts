/**
 * The document model: what a document is, before anyone has read it.
 *
 * Deliberately free of the parsing contract and of the refusal — those are `Document.parser.ts`
 * and `Document.errors.ts`. A table, a wire schema and a queue payload all need these ids and
 * enums without needing to know how a PDF is read.
 *
 * `Collection` is deliberately NOT here: `policy` filters on it too, so it lives in
 * `shared/domain/Corpus`. See that file for why a type two slices need is a shared type.
 */
import { Schema } from "effect"

export const DocumentId = Schema.String.pipe(Schema.brand("DocumentId"))
export type DocumentId = typeof DocumentId.Type

export const DocumentStatus = Schema.Literals([
  "pending_upload",
  "uploaded",
  "processing",
  "ready",
  "failed"
])
export type DocumentStatus = typeof DocumentStatus.Type

/** What a parser produces: text, plus whatever provenance the parser could establish. */
export class ParsedDocument extends Schema.Class<ParsedDocument>("ParsedDocument")({
  /**
   * The text every `source_span` is checked against. Stored with the extraction so the verbatim
   * claim is re-checkable a year later against the same bytes the check originally ran on.
   */
  text: Schema.String,
  /** Null when the format has no pages (markdown, plain text). */
  pageCount: Schema.NullOr(Schema.Int)
}) {}
