/**
 * Emitting an event: one row, then one message, in that order and never the reverse.
 *
 * **The ordering is the whole design.** No transaction can span Postgres and Cloudflare Queues, so one of
 * them is first and the choice decides which failure mode you get:
 *
 *   row, then send  →  a row with no message. Recoverable: the sweeper re-sends it.
 *   send, then row  →  a message referring to a row that does not exist. The consumer cannot read current
 *                      state, cannot record an outcome, and the work is simply lost.
 *
 * The recoverable direction goes first, and the send failing is therefore **not** an error worth
 * propagating — it is the expected shape of the enqueue gap.
 *
 * Idempotency is by derived key, so emitting twice is a no-op rather than a duplicate: the second insert
 * hits the UNIQUE constraint and returns the existing row's id. That makes this safe to call from a retry
 * path, a webhook, and a cron without coordinating between them.
 */
import { Ids } from "@ea/domain/Ids"
import {
  EventBus,
  type EventId,
  EventId as EventIdSchema,
  type EventType,
  QueueMessage
} from "@ea/modules/shared/domain/Event"
import { Db } from "@ea/modules/shared/tables/Database"
import { Effect } from "effect"

export interface EmitEventInput {
  readonly type: EventType
  /** Derived from the work. See `decideEventKey` / `executeEventKey`. */
  readonly idempotencyKey: string
  readonly payload?: Record<string, unknown> | undefined
}

export interface EmitEventResult {
  readonly eventId: EventId
  /** False when this key had already been emitted, so nothing new was queued. */
  readonly created: boolean
}

export const EmitEvent = (input: EmitEventInput) =>
  Effect.gen(function*() {
    const db = yield* Db
    const ids = yield* Ids
    const bus = yield* EventBus

    const candidateId = yield* ids.next

    /*
     * `on conflict do nothing` plus a `returning` that is empty on conflict, then a read.
     *
     * One statement would be neater but would not tell us whether WE created the row, and that matters:
     * only the creator should send a message, or a duplicate emit would enqueue twice against one row.
     */
    const inserted = yield* db.scopedForOrg((sql, orgId) =>
      sql<{ id: string }>`
        insert into events (id, organization_id, type, idempotency_key, payload)
        values (
          ${candidateId}, ${orgId}, ${input.type}, ${input.idempotencyKey},
          ${JSON.stringify(input.payload ?? {})}::jsonb
        )
        on conflict (organization_id, idempotency_key) do nothing
        returning id
      `
    )

    if (inserted.length === 0) {
      // Already emitted. Return the existing id so a caller can still correlate, and send nothing.
      const existing = yield* db.scopedForOrg((sql, orgId) =>
        sql<{ id: string }>`
          select id from events
           where idempotency_key = ${input.idempotencyKey} and organization_id = ${orgId}
        `
      )
      return {
        eventId: EventIdSchema.make(existing[0]?.id ?? candidateId),
        created: false
      } satisfies EmitEventResult
    }

    const eventId = EventIdSchema.make(inserted[0]!.id)

    /*
     * The gap. A failed send leaves a committed `queued` row, which the sweeper will re-send — so it is
     * swallowed here rather than propagated. Propagating would roll the caller back and lose the row that
     * makes recovery possible.
     */
    yield* Effect.ignore(bus.send(new QueueMessage({ eventId, type: input.type })))

    return { eventId, created: true } satisfies EmitEventResult
  })
