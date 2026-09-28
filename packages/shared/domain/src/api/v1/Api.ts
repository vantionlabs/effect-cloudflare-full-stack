/**
 * The versioned public API contract.
 *
 * One declaration types the server handlers, derives the OpenAPI document, and generates
 * the client — so docs cannot drift from the implementation. Everything under `/api/v1` is
 * frozen: endpoints may be added, never changed in place.
 */
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api"
import { Authenticated } from "../../iam/Authenticated.ts"
import { Collection } from "../../intake/Document.ts"
import { HealthV1 } from "./Health.ts"
import { UnsupportedDocumentV1, UploadAcceptedV1 } from "./Intake.ts"
import { MeV1 } from "./Me.ts"

/** Liveness and capability reporting. Unauthenticated by design. */
export const HealthGroup = HttpApiGroup.make("health").add(
  // At rc.118 success/error are declared in the options object; the fluent
  // `.addSuccess()` of earlier versions no longer exists.
  HttpApiEndpoint.get("get", "/health", { success: HealthV1 })
)

/**
 * Endpoints requiring a session.
 *
 * `.middleware(Authenticated)` applies to the whole group, so adding an endpoint here cannot
 * accidentally be public — the default for this group is protected.
 */
export const MeGroup = HttpApiGroup.make("me")
  .add(HttpApiEndpoint.get("get", "/me", { success: MeV1 }))
  .middleware(Authenticated)

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

export const ApiV1 = HttpApi.make("effect-ai-v1")
  .add(HealthGroup)
  .add(MeGroup)
  .add(IntakeGroup)
  .prefix("/api/v1")
