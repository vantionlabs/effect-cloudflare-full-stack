/**
 * The intake wire contract.
 *
 * Multipart rather than JSON-with-base64: a base64 body inflates a document by a third and forces
 * the whole thing through a string, which for a 10 MB scan is wasteful in a Worker's memory.
 */
import { Schema } from "effect"

export class UploadAcceptedV1 extends Schema.Class<UploadAcceptedV1>("UploadAcceptedV1")({
  document_id: Schema.String,
  intake_id: Schema.String,
  /** Characters of extracted text, so a caller can sanity-check the parse in one round trip. */
  text_length: Schema.Int
}) {}

/**
 * Returned when a document cannot be parsed.
 *
 * 415 Unsupported Media Type, and it names what IS supported — a rejection a caller can act on
 * rather than merely observe. See `UnsupportedDocument` for why refusing beats a partial parse.
 */
export class UnsupportedDocumentV1 extends Schema.Error<UnsupportedDocumentV1>(
  "UnsupportedDocumentV1"
)(
  {
    _tag: Schema.tag("UnsupportedDocumentV1"),
    filename: Schema.String,
    content_type: Schema.String,
    supported: Schema.Array(Schema.String)
  },
  { httpApiStatus: 415 }
) {}
