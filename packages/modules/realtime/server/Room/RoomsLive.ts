/**
 * `Rooms`, over the Durable Object namespace binding.
 *
 * The whole adapter is "name the object, call one method on it". That is not an accident of this being early:
 * a room is stateless fan-out, so there is nothing else for this layer to do (ADR-0018).
 *
 * **It takes the binding, not the environment.** `layer(env.ROOMS)` rather than `yield* Bindings`, so this
 * file names the one capability it uses and nothing else. Three things follow: the adapter can live in a
 * module instead of in the app (the `Env` type is the app's, and an adapter that imported it could not
 * leave), a test double is an object literal rather than a stub of the whole deployment, and `Main.ts` is the
 * only file in the repo that reads `env.*`.
 */
import { encodeServerFrame, type RoomName, Rooms, type ServerFrame } from "@ea/modules/realtime/domain/Room"
import { Effect, Layer } from "effect"

/**
 * What this adapter needs from the platform, declared here rather than in the app's `Env`.
 *
 * Structural, so nothing imports `@cloudflare/workers-types` to satisfy it and a fake is three lines. The
 * app's `Env` refers to *this* type, which is the direction that lets the adapter move: the deployment
 * composes what its adapters ask for, instead of adapters depending on a list of everything the deployment
 * has.
 */
export interface RoomsBinding {
  readonly getByName: (name: string) => {
    /**
     * The upgrade. A `WebSocket` cannot cross a stub boundary (`DataCloneError`, verified — see
     * `ROOM_IDENTITY_HEADER`), so the room creates the pair itself and is entered with a request.
     */
    readonly fetch: (request: Request) => Promise<Response>
    readonly broadcast: (encoded: string) => Promise<void>
  }
}

export const RoomsLive = (rooms: RoomsBinding): Layer.Layer<Rooms> =>
  Layer.succeed(Rooms)({
    broadcast: (room: RoomName, frame: ServerFrame) =>
      /*
       * Encoded HERE, once, rather than inside the room.
       *
       * The room then fans out an opaque string, which keeps the Schema — and therefore the contract — on
       * this side of the boundary where the rest of the codebase can see it. It also means one encode per
       * event instead of one per recipient.
       */
      Effect.tryPromise(() => rooms.getByName(room).broadcast(encodeServerFrame(frame))).pipe(
        /*
         * Swallowed, with a log. `broadcast` cannot fail in its signature, and this is where that promise is
         * kept.
         *
         * The durable write already happened by the time anything broadcasts, and the frame is a nudge the
         * client can live without — it re-reads on its next reconnect. Failing an approval because a
         * notification did not send would be strictly worse than a briefly stale queue. Logged at warning
         * because a *persistent* failure here is a real problem, just not this caller's.
         */
        Effect.tapError((error) =>
          Effect.logWarning("room broadcast failed").pipe(
            Effect.annotateLogs({ room, frame: frame._tag, error: String(error) })
          )
        ),
        Effect.ignore
      )
  })
