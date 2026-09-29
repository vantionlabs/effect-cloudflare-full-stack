/**
 * The transport edge for intake.
 *
 * Thin by design: decode, call the use case, translate the one domain error the frozen v1 contract
 * names. The media type comes from the `content_type` query parameter rather than the request
 * header — see the endpoint declaration for why the header is fixed to `application/octet-stream`.
 */
import { UnsupportedDocumentV1, UploadAcceptedV1 } from "@ea/modules/intake/domain/Intake"
import { IngestUpload } from "@ea/modules/intake/use-cases/Intake"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { ApiV1 } from "../ApiV1.ts"
import { serveForTenant } from "../Serve.ts"

export const IntakeHttp = HttpApiBuilder.group(
  ApiV1,
  "intake",
  (handlers) =>
    handlers.handle("upload", ({ payload, query }) =>
      serveForTenant(
        IngestUpload({
          filename: query.filename,
          // Unknown bytes when the caller did not say: the parser also reads the extension, and a
          // guess dressed up as a declaration is worse than an honest absence.
          contentType: query.content_type ?? "application/octet-stream",
          collection: query.collection,
          bytes: payload
        })
      ).pipe(
        Effect.map((result) =>
          new UploadAcceptedV1({
            document_id: result.documentId,
            intake_id: result.intakeId,
            text_length: result.textLength
          })
        ),
        // The domain error becomes the wire error here, at the boundary — so the frozen v1 shape is
        // not something the use case has to know about.
        Effect.catchTag("UnsupportedDocument", (error) =>
          Effect.fail(
            new UnsupportedDocumentV1({
              filename: error.filename,
              content_type: error.contentType,
              supported: error.supported
            })
          ))
      ))
)
