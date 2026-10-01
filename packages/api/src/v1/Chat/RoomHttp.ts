/** The transport edge for channels. */
import { MessageId } from "@ea/modules/chat/domain/Message"
import { RoomId, RoomNameInvalidV1, RoomNotFoundV1, RoomSlugTakenV1 } from "@ea/modules/chat/domain/Room"
import { MarkRead } from "@ea/modules/chat/use-cases/Read"
import { ArchiveRoom, CreateRoom, ListRooms } from "@ea/modules/chat/use-cases/Room"
import { clampPageSize } from "@ea/modules/shared/domain/Page"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { ApiV1 } from "../ApiV1.ts"
import { keyset2, page } from "../Page.ts"
import { serve } from "../Serve.ts"

export const RoomHttp = HttpApiBuilder.group(
  ApiV1,
  "rooms",
  (handlers) =>
    handlers
      .handle("list", ({ query }) =>
        Effect.gen(function*() {
          const after = yield* keyset2(query.cursor)
          const limit = clampPageSize(query.limit)
          /*
           * `serve`, not `serveForTenant`: `ListRooms` requires `CurrentUser` because the unread count is
           * per-reader, so this is one of the few reads whose answer differs between two members of the same
           * organization.
           */
          const rooms = yield* serve(ListRooms({ limit, ...after === undefined ? {} : { after } }))
          // Keyed on name then id, matching `order by r.name asc, r.id asc`.
          return page(rooms, limit, (room) => [room.name, room.id])
        }))
      .handle("create", ({ payload }) =>
        serve(CreateRoom(payload)).pipe(
          // The domain errors become wire errors HERE, at the boundary, so the use case never learns what a
          // frozen v1 shape looks like. Both are worth telling a caller apart: one is a name it can fix, the
          // other is a handle somebody else already holds.
          Effect.catchTags({
            RoomNameInvalid: (error) => Effect.fail(new RoomNameInvalidV1({ name: error.name, reason: error.reason })),
            RoomSlugTaken: (error) => Effect.fail(new RoomSlugTakenV1({ slug: error.slug }))
          })
        ))
      .handle("setArchived", ({ params, payload }) =>
        serve(ArchiveRoom({ roomId: RoomId.make(params.roomId), archived: payload.archived })).pipe(
          Effect.catchTag("RoomNotFound", () =>
            Effect.fail(new RoomNotFoundV1({ room_id: params.roomId })))
        ))
      .handle("markRead", ({ params, payload }) =>
        serve(
          MarkRead({ roomId: RoomId.make(params.roomId), messageId: MessageId.make(payload.messageId) })
        ).pipe(
          Effect.catchTag("RoomNotFound", () =>
            Effect.fail(new RoomNotFoundV1({ room_id: params.roomId })))
        ))
)
