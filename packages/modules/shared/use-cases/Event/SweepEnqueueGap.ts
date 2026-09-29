/**
 * Re-sends events that were recorded but never enqueued.
 *
 * **The one genuine sweeper**, and `EventTable.ts` has described it since before it existed: no
 * transaction spans the `events` insert and `queue.send`, so a row can be committed with no message
 * behind it. `EmitEvent` swallows a send failure deliberately — propagating would roll the caller back
 * and destroy the very row that makes recovery possible — which means something else has to notice.
 * Without this, a lost `queue.send` is a document that silently never gets decided, with a perfectly
 * good audit row saying `queued` forever.
 *
 * This is the outbox pattern with a cron instead of a transaction. It is only safe because every
 * consumer is idempotent by key: a re-send of a message that *did* arrive is a no-op, since
 * `ConsumeEvent` short-circuits on a row that is no longer `queued`.
 *
 * **Why an age threshold rather than "any queued row".** A row is `queued` for the few milliseconds
 * between commit and the consumer picking it up, so sweeping immediately would re-send nearly every
 * event and double the queue's work. Two minutes is far longer than that window and far shorter than
 * anyone's patience for a stuck document.
 *
 * **What this does NOT do, and how you would know.** A row that is re-sent but still never consumed —
 * a poison event, or a type no consumer handles — is re-sent on every tick, forever. Nothing here
 * bounds that, because bounding it needs a column (`swept_at`, or a sweep counter) and a schema change
 * does not belong in a recovery path added after the fact. The signal is `resent` staying non-zero tick
 * after tick while nothing reaches `done`: a steady state of zero is the healthy shape, so a persistent
 * non-zero count is the alarm. Add the column when that alarm actually fires, not before.
 *
 * **Why it re-sends rather than repairs.** The sweeper does not touch `status`. If it marked rows
 * itself it would be racing the consumer for the same row; instead it re-delivers and lets the
 * consumer's own claim decide. The only state this changes is in the queue.
 */
import { Db } from "@ea/modules/shared/tables/Database"
import { Effect } from "effect"
import { EventBus, EventId as EventIdSchema, QueueMessage } from "../../domain/Event/index.ts"

/**
 * How stale a `queued` row must be before it counts as lost.
 *
 * `EventTable.ts` says "a couple of minutes"; this is that number, named so the query does not carry a
 * bare literal and so the test can reason about the boundary rather than guess it.
 */
const STALE_AFTER = "2 minutes"

/**
 * The most rows one tick will re-send.
 *
 * Bounded because a cron that fans out without a limit turns a bad deploy into a queue flood: if some
 * outage left ten thousand rows unsent, re-sending them all in one invocation would exhaust the batch
 * and the connection budget at once. The next tick takes the next slice, and a backlog draining over
 * several minutes is the correct shape for recovery work.
 */
const MAX_PER_TICK = 100

export interface SweepEnqueueGapResult {
  /** How many rows were re-sent. Zero is the expected steady state. */
  readonly resent: number
  /** True when the limit was hit, so an operator can tell a backlog from a quiet tick. */
  readonly more: boolean
}

export const SweepEnqueueGap = Effect.gen(function*() {
  const db = yield* Db
  const bus = yield* EventBus

  /*
   * Cross-tenant by necessity: a cron has no organization, and "which tenants have stuck work" is the
   * question rather than an input. `unscopedForCron` selects IDENTIFIERS only — id and type, never the
   * payload — which is the rule that keeps an unscoped read from becoming a tenant data leak.
   */
  const stale = yield* db.unscopedForCron((sql) =>
    sql<{ id: string; type: "document.decide" | "decision.execute" }>`
      -- tenant: the organization is the answer
      select id, type
        from events
       where status = 'queued'
         and created_at < now() - interval '${sql.literal(STALE_AFTER)}'
       order by created_at
       limit ${MAX_PER_TICK}
    `
  )

  /*
   * Sequential, and each send is allowed to fail without stopping the sweep.
   *
   * A queue that is refusing sends will refuse the next one too, but a row that cannot be re-sent this
   * tick is still `queued` and will be picked up next tick — so losing one is not losing the work. What
   * WOULD lose work is letting the first failure abandon the remaining rows.
   */
  let resent = 0
  for (const row of stale) {
    const sent = yield* Effect.exit(
      // `EventIdSchema.make`, the same constructor EmitEvent uses: the brand is the type's whole
      // point, and a sweeper is exactly the kind of secondary path that would otherwise bypass it.
      bus.send(new QueueMessage({ eventId: EventIdSchema.make(row.id), type: row.type }))
    )
    if (sent._tag === "Success") resent = resent + 1
  }

  return { resent, more: stale.length === MAX_PER_TICK } satisfies SweepEnqueueGapResult
})
