/**
 * The intake wire contract.
 *
 * Multipart rather than JSON-with-base64: a base64 body inflates a document by a third and forces
 * the whole thing through a string, which for a 10 MB scan is wasteful in a Worker's memory.
 */
import { Authenticated } from "@ea/shared-domain/Identity"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api"
import { Collection } from "../Document/Document.model.ts"

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

/**
 * Document intake.
 *
 * Also behind `Authenticated`: an upload must be attributed to an organization, and there is no
 * such thing as an anonymous document here — the tenant is what every later query filters on.
 */
export const IntakeGroup = HttpApiGroup.make("intake")
  .add(
    HttpApiEndpoint.post("upload", "/intakes", {
      /**
       * The raw document as the request body, with metadata in the query string.
       *
       * Not multipart, for two reasons. Effect's multipart support persists files through
       * `FileSystem`, and a Worker has none (`FileSystem.layerNoop`) — so multipart would need a
       * filesystem we deliberately do not have. And a raw body is simpler for an integrating
       * client than assembling multipart: it is one `curl --data-binary` or one PHP
       * `Http::withBody()`. Base64-in-JSON was the third option and is the worst — a third larger
       * and forced through a string in a Worker's memory.
       */
      payload: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
      query: {
        collection: Collection,
        /** Recorded for the audit trail and shown in the queue. Never used to build a storage key. */
        filename: Schema.String,
        /**
         * The document's real media type, declared here rather than in the `Content-Type` header.
         *
         * Deliberate, and the reason is the product's: `HttpApi` keys payload decoding by content
         * type and answers an unlisted one with a plain-text 415 of its own. Enumerating the
         * accepted document types in the contract would therefore hand the refusal to the
         * framework — and this endpoint's refusal *is* a feature, a typed `UnsupportedDocument`
         * that names what is supported. So the body is always `application/octet-stream` (opaque
         * bytes to the transport) and the parser decides, which is where the decision belongs.
         *
         * Optional because the parser also reads the extension; omit it and it is treated as
         * unknown bytes.
         */
        content_type: Schema.optional(Schema.String)
      },
      success: UploadAcceptedV1,
      error: UnsupportedDocumentV1
    })
  )
  .middleware(Authenticated)
