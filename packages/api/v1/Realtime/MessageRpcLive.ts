/**
 * The message RPC handlers: write, then announce.
 *
 * The ordering is the design (ADR-0018). `PostMessage` puts the row in Postgres and returns it; only then is a
 * frame broadcast, so nothing is ever announced that a reload would not find. A client that misses the frame is
 * one refresh behind; a client that received a frame for a row that was never committed would be showing
 * something that did not happen.
 */
import { type MessageId, MessageRpcs } from "@ea/modules/realtime/domain/Message"
import {
  MessageChanged,
  MessagePosted,
  orgRoom,
  type RoomId,
  type RoomRef,
  Rooms
} from "@ea/modules/realtime/domain/Room"
import {
  DeleteMessage,
  EditMessage,
  ListMessages,
  PostMessage,
  RoomIdOfMessage
} from "@ea/modules/realtime/use-cases/Message"
import { ToggleReaction } from "@ea/modules/realtime/use-cases/Reaction"
import { CurrentUser } from "@ea/modules/shared/domain/Identity"
import { Effect } from "effect"
import { serve } from "../Serve.ts"

/**
 * Tell the room a message changed.
 *
 * The room id is read here rather than returned by the use cases, so that "who needs to be told" stays a
 * transport concern. `RoomsChanged`-style nudges cost one indexed lookup.
 */
const announceChange = (messageId: MessageId) =>
  Effect.gen(function*() {
    const rooms = yield* Rooms
    const identity = yield* CurrentUser
    const roomId = yield* serve(RoomIdOfMessage(messageId))
    if (roomId === null) return
    yield* rooms.broadcast(orgRoom(identity.orgId), new MessageChanged({ roomId: roomId as RoomId, messageId }))
  })

export const MessageRpcLive = MessageRpcs.toLayer(
  Effect.succeed({
    "Message.list": (payload: {
      readonly room: RoomRef
      readonly after?: string | undefined
      readonly limit?: number | undefined
    }) => serve(ListMessages(payload as never)),

    "Message.post": (payload: { readonly room: RoomRef; readonly body: string }) =>
      Effect.gen(function*() {
        const message = yield* serve(PostMessage(payload))
        const rooms = yield* Rooms
        const identity = yield* CurrentUser

        /*
         * Broadcast into the ORGANIZATION's socket room, with the room id inside the frame.
         *
         * One socket room per tenant rather than one per chat room, so there is one connection per person and no
         * subscribe protocol to get wrong — the client decides whether a frame concerns what it has open. The
         * cost is that every member hears about every room, which doubles as the notification everybody wants
         * first; the trigger to split is in `MessagePosted`.
         *
         * Not awaited for correctness — `broadcast` cannot fail — so an unreachable room costs the sender
         * nothing. The message is already saved, which is the only part anybody can lose.
         */
        yield* rooms.broadcast(orgRoom(identity.orgId), new MessagePosted({ message }))

        return message
      }),

    /*
     * Edit and delete announce with `MessageChanged`, which carries no message.
     *
     * The asymmetry with `MessagePosted` is the rule stated in `RoomFrame.ts`: an appended message never changes,
     * so sending it saves a round trip safely, while an edited one can be superseded before the frame lands. A
     * nudge cannot be stale.
     *
     * Both need the room to address the broadcast, and neither use case returns it — so it is read here. A
     * cheaper design would have the use cases return it, and that would put transport's needs into their
     * signatures; this query is one indexed row.
     */
    "Message.edit": (payload: { readonly messageId: MessageId; readonly body: string }) =>
      Effect.tap(serve(EditMessage(payload)), (result) => announceChange(result.messageId)),

    "Message.delete": (payload: { readonly messageId: MessageId }) =>
      Effect.tap(serve(DeleteMessage(payload)), (result) => announceChange(result.messageId)),

    /*
     * A reaction announces with the same `MessageChanged` nudge as an edit. It is a change to a message, and the
     * client's response is identical: re-read the room. A dedicated frame would carry the same information and
     * need its own handler.
     */
    "Message.react": (payload: { readonly messageId: MessageId; readonly emoji: string }) =>
      Effect.tap(serve(ToggleReaction(payload)), (result) => announceChange(result.messageId))
  })
)
