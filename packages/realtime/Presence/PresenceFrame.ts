/**
 * Who is connected, and what they are looking at.
 *
 * **Presence is a TRANSPORT concern, which is why it lives here and chat's frames do not.** It is derived entirely
 * from the live socket set — no feature produces it, no table stores it — so the transport can define it, encode it
 * and answer it without knowing what the sockets are being used for.
 *
 * That is also what makes it strictly better than a presence set in Redis: a crashed node cannot delete its own
 * entries, so such a set needs TTL heartbeats and shows ghosts until they expire, whereas a disconnected socket is
 * simply not in `getWebSockets()` and a ghost is not representable. The corollary is that presence must **not** be
 * persisted — it is meaningful only while sockets exist.
 */
import { UserId } from "@ea/domain/Identity"
import { Schema } from "effect"

export class Viewer extends Schema.Class<Viewer>("Viewer")({
  userId: UserId,
  email: Schema.String,
  /** What they have open — a decision id, a room id, or null. An opaque string to the transport. */
  viewing: Schema.NullOr(Schema.String)
}) {}

/**
 * Client → server. The only frame a client sends, and it is ephemeral by design.
 *
 * Every frame is self-contained because a room hibernates: it leaves memory while its sockets stay connected, so
 * each message is handled with no in-memory context from the last one. That rules out Effect's WebSocket RPC, which
 * keeps a protocol session per connection (ADR-0020).
 */
export class Viewing extends Schema.TaggedClass<Viewing>("Viewing")("Viewing", {
  viewing: Schema.NullOr(Schema.String)
}) {}

export class Welcome extends Schema.TaggedClass<Welcome>("Welcome")("Welcome", {
  viewers: Schema.Array(Viewer)
}) {}

export class Presence extends Schema.TaggedClass<Presence>("Presence")("Presence", {
  viewers: Schema.Array(Viewer)
}) {}

/**
 * The transport's own frames, encoded by the transport.
 *
 * A separate union from the application's: the room sends these itself, on connect and on every change, without any
 * slice being involved. `@ea/api/v1/Frames.ts` includes them in the union the CLIENT decodes, which is the one place
 * both halves of the wire meet.
 */
export const PresenceFrame = Schema.Union([Welcome, Presence])
export type PresenceFrame = typeof PresenceFrame.Type

export const encodePresenceFrame = Schema.encodeUnknownSync(Schema.fromJsonString(PresenceFrame))
export const decodeViewing = Schema.decodeUnknownResult(Schema.fromJsonString(Viewing))
