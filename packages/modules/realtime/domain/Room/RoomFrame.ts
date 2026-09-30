/**
 * What travels over a room's socket, in both directions.
 *
 * **Every frame is self-contained, and that is forced rather than chosen.** A room hibernates — it leaves
 * memory while its sockets stay connected — so each message is handled with no in-memory context from the
 * last one. That rules out Effect's WebSocket RPC, which keeps a protocol session per connection, and it
 * rules out anything resembling a handshake. See ADR-0020.
 *
 * The division of labour with the RPC surface is a rule, not a case-by-case judgement:
 *
 * - **Durable actions go over HTTP RPC.** Posting a message, approving a decision. They must be written to
 *   Postgres before anyone sees them, and the Worker owns the database connection.
 * - **Ephemeral per-connection state goes over the socket.** A ping; which decision you are looking at.
 *   None of it outlives the connection, so a request per change would be pure cost, and the socket already
 *   knows when it ends.
 *
 * Both directions are `Schema`, so one definition serves the browser and the room — the property that made
 * RPC attractive, without a session to keep alive.
 */
import { UserId } from "@ea/modules/shared/domain/Identity"
import { Schema } from "effect"
import { Message } from "../Message/Message.ts"
import { RoomId } from "./Room.ts"

/**
 * The keepalive pair, as bare strings rather than JSON.
 *
 * `setWebSocketAutoResponse` matches the request **exactly** and answers from the runtime without waking
 * the room, so this string must never become a JSON object "for consistency": the moment it does, every
 * ping wakes the room and the hibernation argument is gone. Both are capped at 2,048 characters by the
 * platform, which is not a constraint at four.
 *
 * A browser cannot send a WebSocket protocol ping — the API exposes no `ping()` — which is why this exists
 * at the application level at all. The runtime does answer real protocol pings automatically, but nothing
 * in a browser can send one (`docs/references.md`).
 */
/**
 * Where the socket lives.
 *
 * Here rather than in the Worker because both ends need it and neither owns it — the same reason
 * `RPC_V1_PATH` is in `@ea/api` rather than in a handler. Under `/api/` so the console's own Worker forwards
 * it to the API over the service binding, which is what keeps the upgrade same-origin and therefore
 * cookie-authenticated.
 */
export const REALTIME_PATH = "/api/v1/realtime"

export const PING = "ping"
export const PONG = "pong"

/** Who is connected, and what they are looking at. Ephemeral: it exists only while a socket does. */
export class Viewer extends Schema.Class<Viewer>("Viewer")({
  userId: UserId,
  email: Schema.String,
  /** The decision they have open, or `null` for the queue list. */
  viewing: Schema.NullOr(Schema.String)
}) {}

/**
 * Client → server. A closed set, deliberately small.
 *
 * Anything added here must be safe to handle statelessly and safe to lose, because a room may hibernate
 * between any two frames and a socket may close without warning.
 */
export class Viewing extends Schema.TaggedClass<Viewing>("Viewing")("Viewing", {
  decisionId: Schema.NullOr(Schema.String)
}) {}

/**
 * Server → client.
 *
 * `Welcome` exists because a socket that has just connected knows nothing, and the alternative — letting it
 * discover the room's state from the next change — means a viewer list that is empty until somebody moves.
 */
export class Welcome extends Schema.TaggedClass<Welcome>("Welcome")("Welcome", {
  viewers: Schema.Array(Viewer)
}) {}

export class Presence extends Schema.TaggedClass<Presence>("Presence")("Presence", {
  viewers: Schema.Array(Viewer)
}) {}

/**
 * The queue changed. **A nudge, not the change itself.**
 *
 * The payload is a reason, not a row, and the client re-reads through RPC. That keeps one source of truth:
 * a frame carrying decision fields would be a second copy of the queue arriving by a second route, and the
 * two would disagree the first time a broadcast raced a write. `reason` exists so the console can be
 * specific in the UI — "approved by someone else" reads better than "something changed".
 */
export class QueueChanged extends Schema.TaggedClass<QueueChanged>("QueueChanged")("QueueChanged", {
  reason: Schema.Literals(["decided", "approved", "rejected", "ingested"]),
  /** Who caused it, so a client can ignore its own echo rather than refetching for nothing. */
  byUserId: Schema.NullOr(UserId)
}) {}

/**
 * A message was posted. Carries the message, unlike `QueueChanged`, which carries a reason.
 *
 * **The exception to "a frame is a nudge", and worth stating why.** A queue nudge omits rows because the queue
 * is a list a client can re-read cheaply and precisely — fifty rows behind one indexed query. A thread is
 * append-only, so the frame *is* the delta: sending the message avoids a round trip per message on the hottest
 * path in a chat, and there is no staleness risk because nothing about a posted message changes afterwards.
 * If editing ever arrives, this becomes a nudge like the other.
 *
 * It is broadcast into the ORGANIZATION's room rather than a room per thread, and the subject is inside so a
 * client can decide whether it cares. That keeps one socket per person and no subscribe protocol — at the cost
 * of every member receiving frames for threads they are not reading. Revisit when a single organization's
 * message rate makes that wasteful, or when a thread needs to be visible to fewer people than the tenant.
 */
export class MessagePosted extends Schema.TaggedClass<MessagePosted>("MessagePosted")("MessagePosted", {
  message: Message
}) {}

/**
 * The channel list changed — created, renamed, archived or restored.
 *
 * A nudge with no payload, unlike `MessagePosted`, and the asymmetry is the rule rather than an inconsistency: a
 * room's fields change over its life, so a carried room could be stale, while a posted message never changes. A
 * short list re-read on demand cannot disagree with itself.
 */
export class RoomsChanged extends Schema.TaggedClass<RoomsChanged>("RoomsChanged")("RoomsChanged", {}) {}

/**
 * A message in this room changed — edited or deleted.
 *
 * **A nudge, not the new message, and this is the note in `MessagePosted` coming due.** That docstring said a
 * carried message would have to become a nudge once editing existed, because a carried value can go stale while
 * an append never does. Rather than demoting `MessagePosted` — appending is the hot path and the frame IS the
 * delta there — the mutable case gets its own frame that carries only where to look.
 *
 * `messageId` is included for a future targeted update; the client invalidates the room today, which is correct
 * and one round trip.
 */
export class MessageChanged extends Schema.TaggedClass<MessageChanged>("MessageChanged")("MessageChanged", {
  roomId: RoomId,
  messageId: Schema.String
}) {}

export const ServerFrame = Schema.Union([
  Welcome,
  Presence,
  QueueChanged,
  MessagePosted,
  MessageChanged,
  RoomsChanged
])
export type ServerFrame = typeof ServerFrame.Type

/** Encoding is JSON both ways: the payloads are tiny and a frame a human can read in devtools is worth more
 * than a few bytes — the same reasoning as the RPC serialization choice in Main.ts. */
export const encodeServerFrame = Schema.encodeUnknownSync(Schema.fromJsonString(ServerFrame))
export const decodeServerFrame = Schema.decodeUnknownSync(Schema.fromJsonString(ServerFrame))
/*
 * Decodes `Viewing` directly, because it is the only client frame. A second one makes this a
 * `Schema.Union([...])` — an alias for a one-member union today would just be a second name for the same
 * thing, which knip is right to call a duplicate export.
 */
export const decodeClientFrame = Schema.decodeUnknownResult(Schema.fromJsonString(Viewing))

/**
 * Who is connecting, as the room is told it.
 *
 * **Why a header at all, since a header is a string channel nothing type-checks.** Because the platform
 * leaves no alternative, and it is worth writing down which alternatives were tried:
 *
 * - Passing the socket to a typed RPC method on the stub — `stub.accept(server, identity)` — fails at
 *   runtime with `DataCloneError: Could not serialize object of type "WebSocket"`. A socket cannot cross a
 *   stub boundary, so the `WebSocketPair` must be created *inside* the room, which means the room must be
 *   entered through `fetch` and the only channel into `fetch` is the request. Verified by execution
 *   (`docs/references.md`).
 * - Cloudflare's own examples put the user id in the **URL** (`?userId=…&username=…`). That is strictly
 *   worse: a URL is logged by everything it passes.
 *
 * So: one header, carrying one Schema-encoded value, decoded with the same schema on the other side. That
 * recovers most of what the RPC signature would have given — a missing or malformed identity is a decode
 * failure at a named line, not two silent `null`s — and it keeps the contract in one place rather than in
 * two `headers.get` calls that can drift apart.
 *
 * It is not a trust boundary. The route overwrites this header from the resolved session, so a client that
 * sends its own is ignored; and a Durable Object namespace is only reachable from a Worker in the same
 * account. The header states what the route already decided.
 */
export const ROOM_IDENTITY_HEADER = "x-room-identity"

export class RoomIdentity extends Schema.Class<RoomIdentity>("RoomIdentity")({
  userId: UserId,
  email: Schema.String
}) {}

export const encodeRoomIdentity = Schema.encodeUnknownSync(Schema.fromJsonString(RoomIdentity))
export const decodeRoomIdentity = Schema.decodeUnknownResult(Schema.fromJsonString(RoomIdentity))
