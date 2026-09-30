/**
 * What chat says over the socket.
 *
 * **These live with the feature, not with the transport.** `@ea/realtime` carries an opaque payload precisely so it
 * does not have to know what a `MessagePosted` is (ADR-0021), and `@ea/api/v1/Frames.ts` assembles every slice's
 * frames into the union the client decodes — the same pattern `RpcV1` already uses for RPC groups.
 *
 * Every frame is self-contained, which is forced rather than chosen: a room hibernates, so each message is handled
 * with no in-memory context from the last one (ADR-0020).
 */
import { Schema } from "effect"
import { Message } from "../Message/Message.ts"
import { RoomId } from "./Room.ts"

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

/** Chat's frames, for the api package to fold into the client's union. */
export const ChatFrame = Schema.Union([MessagePosted, MessageChanged, RoomsChanged])
export type ChatFrame = typeof ChatFrame.Type
