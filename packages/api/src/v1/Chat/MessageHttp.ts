/** The transport edge for a room's messages. */
import { RoomById, RoomId, RoomNotFoundV1 } from "@ea/modules/chat/domain/Room"
import { ListMessages } from "@ea/modules/chat/use-cases/Message"
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
    handlers.handle("list", ({ params, query }) =>
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
)
