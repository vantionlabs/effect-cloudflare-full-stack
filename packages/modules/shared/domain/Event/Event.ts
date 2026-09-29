/**
 * The event union, and the keys that make redelivery free.
 *
 * Every idempotency key here is **derived from the work**, never generated. That is what lets a retry at
 * any layer — Queues redelivering, a cron re-sending after the enqueue gap, a client POSTing twice —
 * land on the same identity and hit a UNIQUE constraint instead of the model.
 */
import { Schema } from "effect"

export const EventId = Schema.String.pipe(Schema.brand("EventId"))
export type EventId = typeof EventId.Type

export const EventType = Schema.Literals(["document.decide", "decision.execute"])
export type EventType = typeof EventType.Type

/**
 * What travels on the queue. Deliberately just an id and a tag.
 *
 * The row is the source of truth, so a redelivery reads **current** state rather than a snapshot of what
 * was true when the message was written. A fat message body is a second source of truth that goes stale
 * without anyone noticing — and on a queue with at-least-once delivery it will be read after the state
 * it describes has moved on.
 */
export class QueueMessage extends Schema.Class<QueueMessage>("QueueMessage")({
  eventId: EventId,
  type: EventType
}) {}

/** `document.decide` — the key a decide event is deduplicated by. Matches `decisions.decide_key`. */
export const decideEventKey = (documentId: string, vertical: string) => `decision:${documentId}:${vertical}`

/**
 * `decision.execute` — the key an execution is deduplicated by.
 *
 * Also used for the `executions` row, deliberately: the plan's unclosable failure is the adapter call
 * succeeding while the recording write is lost, and one key across both layers is what lets a
 * reconciliation ask "did this already happen?" and get a usable answer.
 */
export const executeEventKey = (decisionId: string, action: string) => `decision:${decisionId}:${action}`
