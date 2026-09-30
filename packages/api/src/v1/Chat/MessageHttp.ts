/** The transport edge for a room's messages. */
import { MessageId, MessageNotFoundV1, NotMessageAuthorV1 } from "@ea/modules/chat/domain/Message"
import { RoomById, RoomId, RoomNotFoundV1 } from "@ea/modules/chat/domain/Room"
import { DeleteMessage, EditMessage, ListMessages, PostMessage } from "@ea/modules/chat/use-cases/Message"
import { ToggleReaction } from "@ea/modules/chat/use-cases/Reaction"
import { clampPageSize } from "@ea/modules/shared/domain/Page"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { ApiV1 } from "../ApiV1.ts"
import { keyset1, page } from "../Page.ts"
import { serve } from "../Serve.ts"

export const MessageHttp = HttpApiBuilder.group(
  ApiV1,
  "messages",
  (handlers) =>
    handlers
      .handle("list", ({ params, query }) =>
        Effect.gen(function*() {
          // One component: messages are ordered by id alone, which is chronological because ids are UUIDv7.
          const after = yield* keyset1(query.cursor)
          const limit = clampPageSize(query.limit)
          const messages = yield* Effect.catchTag(
            serve(ListMessages({
              room: new RoomById({ roomId: RoomId.make(params.roomId) }),
              limit,
              ...after === undefined ? {} : { after: after[0] as never }
            })),
            "RoomNotFound",
            () => Effect.fail(new RoomNotFoundV1({ room_id: params.roomId }))
          )
          return page(messages, limit, (message) => [message.id])
        }))
      .handle("post", ({ params, payload }) =>
        Effect.catchTag(
          serve(PostMessage({ room: new RoomById({ roomId: RoomId.make(params.roomId) }), body: payload.body })),
          "RoomNotFound",
          () => Effect.fail(new RoomNotFoundV1({ room_id: params.roomId }))
        ))
      .handle("edit", ({ params, payload }) =>
        serve(EditMessage({ messageId: MessageId.make(params.messageId), body: payload.body })).pipe(
          Effect.catchTag("MessageNotFound", () =>
            Effect.fail(new MessageNotFoundV1({ message_id: params.messageId }))),
          // 403 rather than 404: the caller can already read this message, so learning that somebody else
          // wrote it reveals nothing. See NotMessageAuthorV1.
          Effect.catchTag("NotMessageAuthor", () =>
            Effect.fail(new NotMessageAuthorV1({ message_id: params.messageId })))
        ))
      .handle("delete", ({ params }) =>
        serve(DeleteMessage({ messageId: MessageId.make(params.messageId) })).pipe(
          Effect.catchTag("MessageNotFound", () =>
            Effect.fail(new MessageNotFoundV1({ message_id: params.messageId }))),
          Effect.catchTag("NotMessageAuthor", () =>
            Effect.fail(new NotMessageAuthorV1({ message_id: params.messageId })))
        ))
      /*
       * `desired` is passed on both, which is what makes these idempotent: a retried PUT leaves the reaction
       * present rather than toggling it away. The RPC path still toggles, because the console's button does.
       */
      .handle("react", ({ params }) =>
        Effect.catchTag(
          serve(ToggleReaction({
            messageId: MessageId.make(params.messageId),
            emoji: params.emoji,
            desired: true
          })),
          "MessageNotFound",
          () => Effect.fail(new MessageNotFoundV1({ message_id: params.messageId }))
        ))
      .handle("unreact", ({ params }) =>
        Effect.catchTag(
          serve(ToggleReaction({
            messageId: MessageId.make(params.messageId),
            emoji: params.emoji,
            desired: false
          })),
          "MessageNotFound",
          () => Effect.fail(new MessageNotFoundV1({ message_id: params.messageId }))
        ))
)
