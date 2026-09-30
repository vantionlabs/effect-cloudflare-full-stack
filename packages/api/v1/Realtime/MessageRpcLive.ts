/**
 * The message RPC handlers: write, then announce.
 *
 * The ordering is the design (ADR-0018). `PostMessage` puts the row in Postgres and returns it; only then is a
 * frame broadcast, so nothing is ever announced that a reload would not find. A client that misses the frame
 * is one refresh behind; a client that received a frame for a row that was never committed would be showing
 * something that did not happen.
 */
import { MessageRpcs } from "@ea/modules/realtime/domain/Message"
import { MessagePosted, orgRoom, Rooms } from "@ea/modules/realtime/domain/Room"
import { ListMessages, PostMessage } from "@ea/modules/realtime/use-cases/Message"
import { CurrentUser } from "@ea/modules/shared/domain/Identity"
import { Effect } from "effect"
import { serve } from "../Serve.ts"

export const MessageRpcLive = MessageRpcs.toLayer(
  Effect.succeed({
    "Message.list": (payload: {
      readonly subjectKind: "organization" | "decision"
      readonly subjectId: string
      readonly after?: string | undefined
      readonly limit?: number | undefined
    }) => serve(ListMessages(payload as never)),

    "Message.post": (payload: {
      readonly subjectKind: "organization" | "decision"
      readonly subjectId: string
      readonly body: string
    }) =>
      Effect.gen(function*() {
        const message = yield* serve(PostMessage(payload))
        const rooms = yield* Rooms
        const identity = yield* CurrentUser

        /*
         * Broadcast into the ORGANIZATION's room, with the subject inside the frame.
         *
         * One room per tenant rather than one per thread, so there is one socket per person and no subscribe
         * protocol to get wrong — the client decides whether a frame concerns the thread it has open. The cost
         * is that every member hears about every thread, which doubles as the notification everybody wants
         * first; the trigger to split is in `MessagePosted`.
         *
         * Not awaited for correctness — `broadcast` cannot fail — so a room that is unreachable costs the
         * sender nothing. The message is already saved, which is the only part anybody can lose.
         */
        yield* rooms.broadcast(orgRoom(identity.orgId), new MessagePosted({ message }))

        return message
      })
  })
)
