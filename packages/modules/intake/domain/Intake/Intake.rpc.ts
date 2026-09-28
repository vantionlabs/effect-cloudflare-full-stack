/**
 * The intake RPC contract: what the reviewer console asks about arrivals.
 *
 * Note what is NOT here: upload. A raw-bytes body belongs on HTTP, where it is one
 * `curl --data-binary` and costs nothing to send; over JSON-serialised RPC the same document would be
 * base64 and a third larger. Transports are additive, so each carries what it is good at rather than
 * mirroring the other for symmetry's sake.
 */
import { AuthenticatedRpc } from "@ea/modules/shared/domain/Identity"
import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { Collection, DocumentId, DocumentStatus } from "../Document/Document.model.ts"
import { IntakeId, IntakeSource } from "./Intake.model.ts"

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

export const IntakeRpcs = RpcGroup.make(
  Rpc.make("Intake.list", {
    payload: {
      /** Newest first. Capped in the handler, not trusted from here. */
      limit: Schema.optional(Schema.Int),
      collection: Schema.optional(Collection)
    },
    success: Schema.Array(IntakeListItem)
  })
).middleware(AuthenticatedRpc)
