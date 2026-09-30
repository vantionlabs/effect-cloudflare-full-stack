/**
 * The room RPC contract: list, create, archive.
 *
 * Channels only. A decision's thread has no management surface — it is created by posting in it and reached
 * through the decision — so exposing create or archive for one would be offering operations with no meaning.
 *
 * `Room.list` deliberately does not take a filter. A channel list is short by nature, and an endpoint that grew
 * options would be answering a question nobody has yet.
 */
import { AuthenticatedRpc } from "@ea/domain/Identity"
import { RoomArchived, RoomNameInvalid, RoomNotFound, RoomSlugTaken } from "@ea/modules/realtime/domain/Errors"
import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { MessageId } from "../Message/Message.ts"
import { MAX_ROOM_NAME_LENGTH, MAX_ROOM_TOPIC_LENGTH, Room, RoomId } from "./Room.ts"

export const RoomRpcs = RpcGroup.make(
  Rpc.make("Room.list", {
    payload: {},
    success: Schema.Array(Room)
  }),
  Rpc.make("Room.create", {
    payload: {
      name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_ROOM_NAME_LENGTH)),
      topic: Schema.optional(Schema.String.check(Schema.isMaxLength(MAX_ROOM_TOPIC_LENGTH)))
    },
    success: Room,
    /*
     * Both refusals are in the contract, because a caller acts on them differently: a taken slug means "go to
     * the channel that exists", an invalid name means "type a different one". Collapsing them into one error
     * would make the console guess which advice to give.
     */
    error: Schema.Union([RoomSlugTaken, RoomNameInvalid])
  }),
  Rpc.make("Room.archive", {
    payload: { roomId: RoomId, archived: Schema.Boolean },
    success: Room,
    error: RoomNotFound
  }),
  /*
   * On `Room` rather than on `Message`, because it is a fact about a reader and a ROOM — "I am up to here" — and
   * the unread count it feeds is a room's field. A client calls it as it renders a thread, which is why the use
   * case is idempotent and monotonic rather than trusting the caller to only ever move forward.
   */
  Rpc.make("Room.markRead", {
    payload: { roomId: RoomId, messageId: MessageId },
    success: Schema.Struct({ roomId: RoomId, lastReadMessageId: MessageId }),
    error: RoomNotFound
  })
).middleware(AuthenticatedRpc)

/** Re-exported so a client importing the group also gets the failures it must handle. */
export { RoomArchived }
