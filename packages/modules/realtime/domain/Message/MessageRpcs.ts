/**
 * The message RPC contract.
 *
 * Reading and posting go over RPC, not over the socket. That split is ADR-0020's rule rather than a
 * preference: a message must be in Postgres before anyone sees it, so it needs the database connection, the
 * error channel and a response the caller can act on — all of which the RPC path has and a fire-and-forget
 * frame does not. The socket only carries the notification afterwards.
 */
import { AuthenticatedRpc } from "@ea/domain/Identity"
import { MessageNotFound, NotMessageAuthor, RoomArchived, RoomNotFound } from "@ea/modules/realtime/domain/Errors"
import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { RoomRef } from "../Room/Room.ts"
import { MAX_BODY_LENGTH, MAX_EMOJI_LENGTH, Message, MessageId } from "./Message.ts"

/**
 * A body that is actually a message.
 *
 * Trimmed and bounded in the CONTRACT, so an empty string is refused before it reaches a use case and a
 * 100 KB paste is refused before it reaches a broadcast. The same bound is a CHECK on the column: the schema
 * is a better error message, the constraint is the guarantee.
 */
const MessageBody = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_BODY_LENGTH))

export const MessageRpcs = RpcGroup.make(
  Rpc.make("Message.list", {
    payload: {
      /**
       * A room REFERENCE, not an id, so a caller can name a decision's thread without knowing whether it
       * exists — it is created by the first message. See `RoomRef`.
       */
      room: RoomRef,
      /**
       * Keyset pagination, and it is the same query a reconnecting client uses to catch up.
       *
       * "Everything after this id" rather than an offset, because ids are time-ordered (UUIDv7) so `id >`
       * is chronological — and because an offset shifts under inserts, which is precisely what a live thread
       * does. One query shape serves the first page, the next page and the catch-up.
       */
      after: Schema.optional(MessageId),
      limit: Schema.optional(Schema.Int)
    },
    success: Schema.Array(Message),
    /*
     * Reading can fail, once a room can be addressed by id: an id that names no room in this organization is a
     * refusal rather than an empty list, because an id is something the caller got from us and a typo should
     * not read as "that channel is quiet".
     *
     * A room referenced by DECISION cannot fail this way — a thread that does not exist yet reads as empty,
     * since it is created by the first message.
     */
    error: RoomNotFound
  }),
  Rpc.make("Message.post", {
    payload: {
      room: RoomRef,
      body: MessageBody
    },
    /**
     * Returns the stored message, not an acknowledgement.
     *
     * The caller needs the id and the server's timestamp to render it, and returning them means the poster's
     * copy is the same row everybody else will receive over the socket rather than a local reconstruction
     * that might differ.
     */
    success: Message,
    /*
     * Two refusals, and a caller acts on them differently: `RoomNotFound` means the room is gone or was never
     * theirs, `RoomArchived` means it exists and is closed — un-archive it, or post elsewhere. Collapsing them
     * would make the console guess which advice to give.
     */
    error: Schema.Union([RoomNotFound, RoomArchived])
  }),
  /*
   * Edit and delete are separate methods rather than one `update` taking an optional body, for the same reason
   * approve and reject are separate on the decision group: they are different acts. One changes a record, the
   * other removes it, and a mis-wired button should be a different method rather than a different argument.
   */
  Rpc.make("Message.edit", {
    payload: { messageId: MessageId, body: MessageBody },
    success: Schema.Struct({ messageId: MessageId, editedAt: Schema.String }),
    error: Schema.Union([MessageNotFound, NotMessageAuthor])
  }),
  Rpc.make("Message.delete", {
    payload: { messageId: MessageId },
    success: Schema.Struct({ messageId: MessageId }),
    error: Schema.Union([MessageNotFound, NotMessageAuthor])
  }),
  /*
   * ONE method, because to a user a reaction is one button. Separate add and remove would make the client track
   * which it should call, which is state it would get wrong the moment two people react at once.
   *
   * No `NotMessageAuthor` here: reacting to somebody else's message is the entire point.
   */
  Rpc.make("Message.react", {
    payload: {
      messageId: MessageId,
      emoji: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_EMOJI_LENGTH))
    },
    success: Schema.Struct({ messageId: MessageId, emoji: Schema.String, reacted: Schema.Boolean }),
    error: MessageNotFound
  })
).middleware(AuthenticatedRpc)
