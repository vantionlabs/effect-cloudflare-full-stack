/**
 * The port for talking to a room. **It carries an opaque payload.**
 *
 * That is the decision that lets this be a package at all (ADR-0021). `broadcast` used to take a `ServerFrame`, and
 * that union named a chat `Message` — so the transport knew what a chat was, and a capability package would have
 * depended on a feature. A string breaks the cycle in the honest direction: a socket has no business knowing what
 * a `QueueChanged` is.
 *
 * What is lost is type safety at this one boundary, and it is bought back where it belongs: each slice defines its
 * own frame classes, `@ea/api/v1/Frames.ts` assembles them into a union and owns the codec — exactly as it already
 * assembles `RpcV1` from each slice's `RpcGroup` — and the transport edges encode before calling this. So the wire
 * has one schema, in one place, and it is not here.
 *
 * `connect` is deliberately absent: accepting a socket needs the platform's own `Request`/`Response` and a Durable
 * Object stub, which is why the upgrade lives in `Server/` and this is what the rest of the code sees.
 *
 * **Fire-and-forget, and typed that way.** `broadcast` cannot fail in the error channel, because nothing a caller
 * does about a failed broadcast is right: the durable write has already happened, the frame is a notification, and
 * the client will re-read on its next reconnect. Failing an approval because a notification did not send would be
 * strictly worse than a stale queue. A transport failure is logged inside the implementation.
 */
import { Context, type Effect } from "effect"
import type { RoomName } from "./RoomName.ts"

export interface RoomsService {
  /**
   * `payload` is an encoded frame. The caller owns the schema; see `@ea/api/v1/Frames.ts`.
   *
   * Encoded by the CALLER rather than here, so one encode serves every recipient and the contract stays visible to
   * the code that owns it.
   */
  readonly broadcast: (room: RoomName, payload: string) => Effect.Effect<void>
}

export class Rooms extends Context.Service<Rooms, RoomsService>()("realtime/Rooms") {}
