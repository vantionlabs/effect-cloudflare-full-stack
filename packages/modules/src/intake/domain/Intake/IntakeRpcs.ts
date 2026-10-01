/**
 * The intake RPC contract: what the reviewer console asks about arrivals.
 *
 * Note what is NOT here: upload. A raw-bytes body belongs on HTTP, where it is one
 * `curl --data-binary` and costs nothing to send; over JSON-serialised RPC the same document would be
 * base64 and a third larger. Transports are additive, so each carries what it is good at rather than
 * mirroring the other for symmetry's sake.
 */
import { AuthenticatedRpc } from "@ea/domain/Identity"
import { Collection } from "@ea/modules/shared/domain/Corpus"
import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { DocumentId, DocumentStatus } from "../Document/Document.ts"
import { UnsupportedDocument } from "../Errors/UnsupportedDocument.ts"
import { IntakeId, IntakeSource } from "./Intake.ts"

/**
 * One row of the arrivals list. Domain types and camelCase, because the only caller is our own
 * console — see `Identity.rpc.ts` for why that licence is deliberate rather than sloppy.
 */
export class IntakeListItem extends Schema.Class<IntakeListItem>("IntakeListItem")({
  intakeId: IntakeId,
  documentId: DocumentId,
  filename: Schema.String,
  collection: Collection,
  source: IntakeSource,
  status: DocumentStatus,
  sizeBytes: Schema.Int,
  receivedAt: Schema.String
}) {}

/** A stored document and its intake. The pipeline it starts (decide or index) runs after this answers. */
export class UploadAccepted extends Schema.Class<UploadAccepted>("UploadAccepted")({
  documentId: DocumentId,
  intakeId: IntakeId,
  textLength: Schema.Int
}) {}

export const IntakeRpcs = RpcGroup.make(
  Rpc.make("Intake.list", {
    payload: {
      /** Newest first. Capped in the handler, not trusted from here. */
      limit: Schema.optional(Schema.Int),
      collection: Schema.optional(Collection)
    },
    success: Schema.Array(IntakeListItem)
  }),
  /*
   * The console's upload, so it uses the same typed client as everything else rather than a plain fetch.
   *
   * The bytes are BASE64 because RPC serialization here is JSON — a `Uint8Array` would serialize as an object of
   * indices. That costs a third more on the wire, which for documents a person picks one at a time is the right
   * trade for one client and one contract. The v1 HTTP endpoint keeps the raw binary body for integrators.
   */
  Rpc.make("Intake.upload", {
    payload: {
      filename: Schema.String,
      /** What the browser says the file is. The parser also reads the extension, so it may be empty. */
      contentType: Schema.String,
      collection: Collection,
      bytes: Schema.Uint8ArrayFromBase64
    },
    success: UploadAccepted,
    error: UnsupportedDocument
  })
).middleware(AuthenticatedRpc)
