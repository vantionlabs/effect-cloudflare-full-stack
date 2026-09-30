/** The transport edge for channels. */
import { ListRooms } from "@ea/modules/chat/use-cases/Room"
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
    handlers.handle("list", ({ query }) =>
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
)
