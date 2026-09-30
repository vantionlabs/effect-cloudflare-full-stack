/**
 * The v1 frame manifest: every slice's socket frames, merged into one union.
 *
 * A manifest and nothing else, exactly like `RpcV1.ts` next door — and for the same reason. Each slice owns the
 * frames it sends, beside the domain types they carry; this file is the single place that says which of them appear
 * on the wire, and the single place that owns the codec.
 *
 * **Why this file has to exist.** `@ea/realtime` broadcasts an OPAQUE payload, because a transport that named a
 * `QueueChanged` would be a capability package depending on a feature (ADR-0021). Something still has to decide what
 * the wire looks like, and a client still has to decode one union. That is a composition job, which is what this
 * package is for — the api package already collects `RpcGroup`s the same way.
 *
 * Adding a frame to the product is therefore a one-line diff here, and a slice whose frames are not on the wire is
 * visibly absent rather than accidentally so.
 */
import { ChatFrame } from "@ea/modules/chat/domain/Room"
import { DecisionFrame } from "@ea/modules/decision/domain/Decision"
import { PresenceFrame } from "@ea/realtime/Presence"
import { Schema } from "effect"

/**
 * Everything a client may receive.
 *
 * Presence comes from the transport itself — the room sends `Welcome` on connect and `Presence` on every change,
 * with no slice involved — so it is folded in here rather than owned by a feature.
 */
export const ServerFrame = Schema.Union([PresenceFrame, ChatFrame, DecisionFrame])
export type ServerFrame = typeof ServerFrame.Type

/**
 * The codec, owned here because the union is.
 *
 * `encodeFrame` is called by the transport EDGES in this package before handing the string to
 * `Rooms.broadcast`, which is what keeps the schema on this side of the boundary where the rest of the codebase can
 * see it — and means one encode per event rather than one per recipient.
 */
export const encodeFrame = Schema.encodeUnknownSync(Schema.fromJsonString(ServerFrame))
export const decodeFrame = Schema.decodeUnknownSync(Schema.fromJsonString(ServerFrame))
