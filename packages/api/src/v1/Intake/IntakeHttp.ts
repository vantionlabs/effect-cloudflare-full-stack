/**
 * The transport edge for intake.
 *
 * Thin by design: decode, call the use case, translate the one domain error the frozen v1 contract
 * names. The media type comes from the `content_type` query parameter rather than the request
 * header — see the endpoint declaration for why the header is fixed to `application/octet-stream`.
 */
import { UnsupportedDocumentV1, UploadAcceptedV1 } from "@ea/modules/intake/domain/Intake"
import { IngestUpload, ListIntakes } from "@ea/modules/intake/use-cases/Intake"
import { clampPageSize } from "@ea/modules/shared/domain/Page"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { ApiV1 } from "../ApiV1.ts"
import { keyset2, page } from "../Page.ts"
import { serveForTenant } from "../Serve.ts"

export const IntakeHttp = HttpApiBuilder.group(
  ApiV1,
  "intake",
  (handlers) =>
    handlers
      .handle("list", ({ query }) =>
        Effect.gen(function*() {
          const after = yield* keyset2(query.cursor)
          const limit = clampPageSize(query.limit)
          const items = yield* serveForTenant(
            ListIntakes({
              limit,
              ...after === undefined ? {} : { after },
              ...query.collection === undefined ? {} : { collection: query.collection }
            })
          )
          // Keyed on received-at then id, matching `order by i.received_at desc, i.id desc`. Arrivals read
          // newest-first, which is the opposite of the queue and the reason the keyset is per collection.
          return page(items, limit, (item) => [item.receivedAt, item.intakeId])
        }))
      .handle("upload", ({ payload, query }) =>
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
