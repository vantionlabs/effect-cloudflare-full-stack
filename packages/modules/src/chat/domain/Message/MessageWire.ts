/**
 * The public contract for messages, as a subresource of a room.
 *
 * `/rooms/:roomId/messages` rather than `/messages?room_id=`: a message does not exist outside a room, the room
 * is what authorises reading it, and the nesting says so in the URL rather than in prose.
 *
 * A separate group from `rooms` even though the path is nested, because a group is a concept and these are two —
 * the group name never appears in a URL, so nesting costs nothing here.
 */
import { Authenticated } from "@ea/domain/Identity"
import { RoomNotFoundV1 } from "@ea/modules/chat/domain/Room"
import { pageOf, pickFields, wire, wireFrom } from "@ea/modules/shared/domain/Wire"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema } from "effect/http-api"
import { Message, MessageMention, MessageReaction } from "./Message.ts"

/**
 * `HttpApiEndpoint` pre-makes `get`, `post`, `put` and `patch` and not `DELETE`, so this does it.
 *
 * `make` is the general constructor the four are built from — `export const get = make("GET")` — so this is the
 * intended way rather than a workaround.
 */
const del = HttpApiEndpoint.make("DELETE")

/** An emoji, its count, and whether the reader is one of them. Aggregated, not listed per person. */
export const MessageReactionV1 = wireFrom(MessageReaction, ["emoji", "count", "mine"])

/** Somebody a message named. `user_id` is what a client compares; the email is display and may be null. */
export const MessageMentionV1 = wireFrom(MessageMention, ["userId", "email"])

/**
 * One message.
 *
 * `deleted_at` is published and the body is not removed, because a deleted message keeps its row and loses its
 * content — a client branches on `deleted_at` rather than trying to recognise the sentinel body. Built with
 * `wire` and a spread because both nested arrays need their own wire versions.
 */
export const MessageV1 = wire({
  ...pickFields(Message.fields, [
    "id",
    "roomId",
    "authorUserId",
    "authorEmail",
    "body",
    "createdAt",
    "editedAt",
    "deletedAt"
  ]),
  reactions: Schema.Array(MessageReactionV1),
  mentions: Schema.Array(MessageMentionV1)
})

/** A message id that names nothing the caller may see. Says nothing about why. */
export class MessageNotFoundV1 extends Schema.Error<MessageNotFoundV1>(
  "MessageNotFoundV1"
)({ _tag: Schema.tag("MessageNotFoundV1"), message_id: Schema.String }, { httpApiStatus: 404 }) {}

/**
 * 403, not 404: the message exists and the caller may read it, but only its author may change it.
 *
 * Distinguishable from `MessageNotFoundV1` on purpose, and the distinction is safe — the caller can already see
 * the message, so learning that somebody else wrote it reveals nothing new. Contrast the 404s on decisions and
 * rooms, where the existence of the row is itself the secret.
 */
export class NotMessageAuthorV1 extends Schema.Error<NotMessageAuthorV1>(
  "NotMessageAuthorV1"
)({ _tag: Schema.tag("NotMessageAuthorV1"), message_id: Schema.String }, { httpApiStatus: 403 }) {}

export const MessageGroup = HttpApiGroup.make("messages")
  .add(
    HttpApiEndpoint.get("list", "/rooms/:roomId/messages", {
      params: { roomId: Schema.String },
      query: {
        cursor: Schema.optional(Schema.String),
        limit: Schema.optional(Schema.FiniteFromString)
      },
      success: pageOf(MessageV1),
      error: [RoomNotFoundV1, HttpApiError.BadRequest]
    })
  )
  .add(
    HttpApiEndpoint.post("post", "/rooms/:roomId/messages", {
      params: { roomId: Schema.String },
      payload: wire({ body: Schema.String }),
      /**
       * **201**, and the stored message rather than an acknowledgement: a client renders what was written, ids
       * and all. Annotated here and not on `MessageV1`, which is the 200 body of the collection.
       */
      success: MessageV1.pipe(HttpApiSchema.status(201)),
      error: RoomNotFoundV1
    })
  )
  .add(
    /** `PATCH`, because an edit changes one field of an existing message rather than replacing it. */
    HttpApiEndpoint.patch("edit", "/messages/:messageId", {
      params: { messageId: Schema.String },
      payload: wire({ body: Schema.String }),
      success: wire({ messageId: Schema.String, editedAt: Schema.String }),
      error: [MessageNotFoundV1, NotMessageAuthorV1]
    })
  )
  .add(
    /*
     * `DELETE`, and the row survives it.
     *
     * A deleted message keeps its row and loses its content, so this is a redaction rather than a removal — the
     * method is still right, because to a caller the message is gone, and `deleted_at` is what a reader branches
     * on. Deleting the row would take the thread's shape with it.
     */
    del("delete", "/messages/:messageId", {
      params: { messageId: Schema.String },
      success: wire({ messageId: Schema.String }),
      error: [MessageNotFoundV1, NotMessageAuthorV1]
    })
  )
  .add(
    /*
     * `PUT` means "my reaction is present", `DELETE` means "absent" — both idempotent.
     *
     * The use case is a toggle, because to a user it is one button, and **a toggle is unsafe over HTTP**: a
     * client that retries after a lost response would take its own reaction back. So the edge states the
     * intended state rather than asking for a flip, and `ToggleReaction` grew a `desired` parameter for it.
     */
    HttpApiEndpoint.put("react", "/messages/:messageId/reactions/:emoji", {
      params: { messageId: Schema.String, emoji: Schema.String },
      success: wire({ messageId: Schema.String, emoji: Schema.String, reacted: Schema.Boolean }),
      error: MessageNotFoundV1
    })
  )
  .add(
    del("unreact", "/messages/:messageId/reactions/:emoji", {
      params: { messageId: Schema.String, emoji: Schema.String },
      success: wire({ messageId: Schema.String, emoji: Schema.String, reacted: Schema.Boolean }),
      error: MessageNotFoundV1
    })
  )
  .middleware(Authenticated)
