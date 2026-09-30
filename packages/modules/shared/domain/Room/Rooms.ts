/**
 * The port for talking to a room, as a service.
 *
 * `broadcast` only. There is deliberately no `connect` here: accepting a socket needs the platform's own
 * `Request`/`Response` and a Durable Object stub, and this ring is compiled with `types: []` precisely so
 * that platform globals cannot leak into it. The upgrade therefore lives with the composition root, in
 * `apps/worker/src/platform/RealtimeHttp.ts`, and this is what the rest of the code sees.
 *
 * Modelled on `EventBus` next door, which is the same shape for the same reason: a use case that wants to
 * announce something should not know whether the announcement travels over a queue, a socket, or a test
 * double that records it in an array.
 *
 * **Fire-and-forget, and typed that way.** `broadcast` cannot fail in the error channel, because nothing a
 * caller does about a failed broadcast is right: the durable write has already happened, the frame is a
 * nudge, and the client will re-read on its next poll or reconnect. Failing a successful approval because a
 * notification did not send would be strictly worse than a stale queue. A transport failure is logged
 * inside the implementation.
 */
import { Context, type Effect } from "effect"
import type { ServerFrame } from "./RoomFrame.ts"
import type { RoomName } from "./RoomName.ts"

export interface RoomsService {
  readonly broadcast: (room: RoomName, frame: ServerFrame) => Effect.Effect<void>
}

export class Rooms extends Context.Service<Rooms, RoomsService>()("shared/Rooms") {}
