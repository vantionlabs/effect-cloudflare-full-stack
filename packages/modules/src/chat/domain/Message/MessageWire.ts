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
import { HttpApiEndpoint, HttpApiError, HttpApiGroup } from "effect/http-api"
import { Message, MessageMention, MessageReaction } from "./Message.ts"

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
  .middleware(Authenticated)
