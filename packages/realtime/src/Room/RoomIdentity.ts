/**
 * Who is connecting, as the room is told it.
 *
 * **Why a header, since a header is a string channel nothing type-checks.** Because the platform leaves no
 * alternative, and it is worth writing down which alternatives were tried:
 *
 * - Passing the socket to a typed RPC method on the stub — `stub.accept(server, identity)` — fails at runtime with
 *   `DataCloneError: Could not serialize object of type "WebSocket"`. A socket cannot cross a stub boundary, so the
 *   `WebSocketPair` must be created *inside* the room, which means the room is entered through `fetch` and the only
 *   channel into `fetch` is the request. Verified by execution (`docs/references.md`).
 * - Cloudflare's own examples put the user id in the **URL** (`?userId=…&username=…`). That is strictly worse: a
 *   URL is logged by everything it passes.
 *
 * So: one header, carrying one Schema-encoded value, decoded with the same schema on the other side. That recovers
 * most of what the RPC signature would have given — a missing or malformed identity is a decode failure at a named
 * line, not two silent `null`s — and keeps the contract in one place rather than in two `headers.get` calls.
 *
 * It is not a trust boundary. The upgrade route rebuilds the header set from the resolved session, so a client that
 * sends its own is ignored; and a Durable Object namespace is only reachable from a Worker in the same account.
 */
import { UserId } from "@ea/domain/Identity"
import { Schema } from "effect"

export const ROOM_IDENTITY_HEADER = "x-room-identity"

export class RoomIdentity extends Schema.Class<RoomIdentity>("RoomIdentity")({
  userId: UserId,
  email: Schema.String
}) {}

export const encodeRoomIdentity = Schema.encodeUnknownSync(Schema.fromJsonString(RoomIdentity))
export const decodeRoomIdentity = Schema.decodeUnknownResult(Schema.fromJsonString(RoomIdentity))

/**
 * Where the socket lives.
 *
 * Here rather than in the Worker because both ends need it and neither owns it — the same reason `RPC_V1_PATH` is in
 * `@ea/api` rather than in a handler. Under `/api/` so the console's own Worker forwards it to the API over the
 * service binding, which is what keeps the upgrade same-origin and therefore cookie-authenticated.
 */
export const REALTIME_PATH = "/api/v1/realtime"

/**
 * The keepalive pair, as bare strings rather than JSON.
 *
 * `setWebSocketAutoResponse` matches the request **exactly** and answers from the runtime without waking the room,
 * so this must never become a JSON object "for consistency": the moment it does, every ping wakes the room and the
 * hibernation argument is gone. Both are capped at 2,048 characters by the platform, which is not a constraint at
 * four.
 *
 * A browser cannot send a WebSocket protocol ping — the API exposes no `ping()` — which is why this exists at the
 * application level at all. The runtime does answer real protocol pings automatically, but nothing in a browser can
 * send one (`docs/references.md`).
 */
export const PING = "ping"
export const PONG = "pong"
