/**
 * The Cloudflare Queues adapter for `EventBus`.
 *
 * As thin as it can be: one `send`. The producer binding is stable for an isolate's lifetime, so unlike
 * the SQL connection it is safe to capture — which is why this takes the queue rather than the whole
 * `Env`, the same narrowing as `DocumentBucket`.
 */
import { EventBus, type EventBusService, EventSendFailed } from "@ea/modules/shared/domain/Event"
import { Context, Effect, Layer } from "effect"

/** The slice of the queue producer used here. Structural, to keep Cloudflare types out of modules. */
export interface QueueProducer {
  readonly send: (body: unknown) => Promise<void>
}

export class EventQueue extends Context.Service<EventQueue, QueueProducer>()("app/EventQueue") {}

export const QueueBus: Layer.Layer<EventBus, never, EventQueue> = Layer.effect(EventBus)(
  Effect.map(EventQueue, (queue) => ({
    send: (message) =>
      Effect.tryPromise({
        try: () => queue.send({ eventId: message.eventId, type: message.type }),
        // Not fatal by design: the committed `events` row is the recovery record, and the sweeper
        // re-sends it. See EmitEvent for why this direction was chosen.
        catch: (cause) => new EventSendFailed(`queue.send failed: ${String(cause)}`)
      })
  } satisfies EventBusService))
)
