/**
 * `Rooms`, over the Durable Object namespace binding.
 *
 * The whole adapter is "name the object, call one method on it". That is not an accident of this being
 * early: a room is stateless fan-out, so there is nothing else for this layer to do (ADR-0018).
 */
import { encodeServerFrame, type RoomName, Rooms, type ServerFrame } from "@ea/modules/shared/domain/Room"
import { Effect, Layer } from "effect"
import { Bindings } from "./Bindings.ts"

export const RoomsLive = Layer.effect(Rooms)(
  Effect.gen(function*() {
    const env = yield* Bindings

    return {
      broadcast: (room: RoomName, frame: ServerFrame) =>
        /*
         * Encoded HERE, once, rather than inside the room.
         *
         * The room then fans out an opaque string, which keeps the Schema — and therefore the contract —
         * on this side of the boundary where the rest of the codebase can see it. It also means one
         * encode per event instead of one per recipient.
         */
        Effect.tryPromise(() => env.ROOMS.getByName(room).broadcast(encodeServerFrame(frame))).pipe(
          /*
           * Swallowed, with a log. `broadcast` cannot fail in its signature, and this is where that
           * promise is kept.
           *
           * The durable write already happened by the time anything broadcasts, and the frame is a nudge
           * the client can live without — it re-reads on its next reconnect. Failing an approval because
           * a notification did not send would be strictly worse than a briefly stale queue. Logged at
           * warning because a *persistent* failure here is a real problem, just not this caller's.
           */
          Effect.tapError((error) =>
            Effect.logWarning("room broadcast failed").pipe(
              Effect.annotateLogs({ room, frame: frame._tag, error: String(error) })
            )
          ),
          Effect.ignore
        )
    }
  })
)
