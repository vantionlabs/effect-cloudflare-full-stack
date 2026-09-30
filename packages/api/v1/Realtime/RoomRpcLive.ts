/**
 * The room RPC handlers: list, create, archive.
 *
 * Thin, like every other edge here. Creating and archiving a channel also ANNOUNCE, because a channel list is
 * shared state: somebody creating `#billing` while a colleague has the app open should appear in their sidebar
 * without a refresh, which is the same argument the queue makes for `QueueChanged`.
 *
 * The frame is a nudge carrying no room, unlike `MessagePosted`. A channel list is short and re-read cheaply,
 * and a room's fields change (rename, topic, archive) — so a carried room could be stale in a way a message
 * never is. That asymmetry is the rule stated in `MessagePosted`, applied in the other direction.
 */
import { RoomsChanged } from "@ea/modules/realtime/domain/Room"
import { orgRoom, RoomRpcs, Rooms } from "@ea/modules/realtime/domain/Room"
import { MarkRead } from "@ea/modules/realtime/use-cases/Read"
import { ArchiveRoom, CreateRoom, ListRooms } from "@ea/modules/realtime/use-cases/Room"
import { CurrentUser } from "@ea/modules/shared/domain/Identity"
import { Effect } from "effect"
import { serve } from "../Serve.ts"

/** Tell everybody the channel list moved. Same shape as `announce` in DecisionRpcLive. */
const announce = Effect.gen(function*() {
  const rooms = yield* Rooms
  const identity = yield* CurrentUser
  yield* rooms.broadcast(orgRoom(identity.orgId), new RoomsChanged())
})

export const RoomRpcLive = RoomRpcs.toLayer(
  Effect.succeed({
    "Room.list": () => serve(ListRooms()),

    "Room.create": (payload: { readonly name: string; readonly topic?: string | undefined }) =>
      Effect.tap(serve(CreateRoom(payload)), () => announce),

    "Room.archive": (payload: { readonly roomId: string; readonly archived: boolean }) =>
      Effect.tap(serve(ArchiveRoom(payload as never)), () => announce),

    /*
     * No broadcast. A read position is one person's fact, and telling the room would wake every other client to
     * re-read a list that has not changed for them — the opposite of what the socket is for.
     */
    "Room.markRead": (payload: { readonly roomId: string; readonly messageId: string }) =>
      serve(MarkRead(payload as never))
  })
)
