/**
 * The intake RPC handlers.
 *
 * Thin by construction: `serve` carries the two decisions every edge in v1 makes — a per-request
 * connection, and a database failure becoming a defect. See `Serve.ts` for why both belong here rather
 * than in the use case.
 */
import { IntakeRpcs, UploadAccepted } from "@ea/modules/intake/domain/Intake"
import { IngestUpload, ListIntakes } from "@ea/modules/intake/use-cases/Intake"
import type { Collection } from "@ea/modules/shared/domain/Corpus"
import { Effect } from "effect"
import { serve, serveForTenant } from "../Serve.ts"

export const IntakeRpcLive = IntakeRpcs.toLayer(
  Effect.succeed({
    "Intake.list": (
      payload: { readonly limit?: number | undefined; readonly collection?: Collection | undefined }
    ) =>
      // `serve` is where the "a database failure is a defect, not a success-shaped empty list" decision
      // lives now — an empty list would read as "nothing has arrived", which is a different fact.
      serve(ListIntakes(payload)),
    "Intake.upload": (payload: {
      readonly filename: string
      readonly contentType: string
      readonly collection: Collection
      readonly bytes: Uint8Array
    }) =>
      // `serveForTenant`, as the HTTP upload edge uses: the intake records who uploaded it, from `CurrentUser`.
      serveForTenant(
        IngestUpload({
          filename: payload.filename,
          contentType: payload.contentType === "" ? "application/octet-stream" : payload.contentType,
          collection: payload.collection,
          bytes: payload.bytes
        })
      ).pipe(Effect.map((result) => new UploadAccepted(result)))
  })
)
