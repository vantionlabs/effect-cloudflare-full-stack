/**
 * Sending a queue message, as a port.
 *
 * Narrow on purpose: one method, taking the tiny body that actually travels. A port rather than the
 * binding directly so the consumer's logic is testable without a queue, and so the enqueue-gap sweeper
 * can be exercised by simply having the send fail.
 */
import { Context, type Effect } from "effect"
import type { QueueMessage } from "./Event.model.ts"

export interface EventBusService {
  readonly send: (message: QueueMessage) => Effect.Effect<void, EventSendFailed>
}

/**
 * The send failed. **Not a fatal error**, which is the whole point.
 *
 * The `events` row is already committed at this stage, so a failed send leaves a recoverable record
 * rather than lost work: the sweeper finds a `queued` row with no message and re-sends it. Treating this
 * as fatal would throw away the one thing that makes the gap survivable.
 */
export class EventSendFailed extends Error {
  readonly _tag = "EventSendFailed"
}

export class EventBus extends Context.Service<EventBus, EventBusService>()("shared/EventBus") {}
