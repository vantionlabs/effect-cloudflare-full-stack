/**
 * `events`: the audit trail for asynchronous work, and the reason Queues alone is not enough.
 *
 * Cloudflare Queues replaces most of what docket built by hand — retries, backoff, a dead-letter queue —
 * so `max_attempts` and `sweep_stale_events` are both **deleted** rather than ported. An invocation that
 * dies without `ack()` is redelivered, so there is no stuck-in-processing state to sweep.
 *
 * Three things Queues does NOT give, which is exactly what this table is for:
 *
 * 1. **Audit.** Queues has no queryable history. That is the product's own thesis applied to its
 *    machinery: if a decision must be explainable a year later, so must the work that produced it.
 * 2. **Idempotency.** Queues has no dedupe and delivers at least once. `idempotency_key` is UNIQUE per
 *    organization, and the key is DERIVED from the work rather than generated — the same key is used for
 *    the `events` row and, later, the `executions` row, so a retry at either layer lands on one identity.
 * 3. **Correlation.** The `id` here goes on every span and log line for the work it causes, which is the
 *    only way to reassemble one document's journey from three invocations.
 *
 * **The enqueue gap is the one genuine sweeper.** No transaction spans this insert and `queue.send`, so a
 * row can exist with no message. A `queued` row older than a couple of minutes is therefore a recovery
 * record, and a cron re-sends it: the outbox pattern with a cron instead of a transaction, which is only
 * safe because every consumer is idempotent by key.
 */
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export const EventTable = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    create table if not exists events (
      id               text primary key,
      -- No FK to better-auth's organization table; see Tenancy.table.ts.
      organization_id  text not null,
      /*
       * The tagged union's tag. A closed set, because an unrecognised event type must not be storable:
       * the consumer dispatches on this, and a typo would produce a row nothing ever handles.
       */
      type             text not null check (type in ('document.decide', 'decision.execute')),
      /*
       * Derived from the work, never generated. UNIQUE per organization, so a duplicate emit hits the
       * constraint instead of the queue — and therefore instead of the model.
       */
      idempotency_key  text not null,
      /*
       * Deliberately tiny: the queue message carries { eventId, type } and nothing else, so a
       * redelivery reads CURRENT state from the database rather than a snapshot of what was true when
       * the message was written. A fat message is a second source of truth that silently goes stale.
       */
      payload          jsonb not null default '{}'::jsonb,
      status           text not null default 'queued' check (
                         status in ('queued', 'processing', 'done', 'failed', 'dead')
                       ),
      -- Set when the consumer classifies a failure as terminal, so the reason is in the product rather
      -- than only in a dashboard.
      error            text,
      -- How many times Queues has handed this to us. Informational: Queues owns the retry policy.
      deliveries       integer not null default 0,
      created_at       timestamptz not null default now(),
      -- Null until a consumer picks it up. The enqueue-gap sweeper looks for queued rows older than
      -- a couple of minutes, which is why this is separate from created_at.
      started_at       timestamptz,
      finished_at      timestamptz,
      /*
       * The Cloudflare Workflow instance carrying this event's work, when one is.
       *
       * The queue consumer no longer runs the decide pipeline inline — it starts a Workflow instance and
       * acks, and the instance owns the row's finish. So "processing" can now mean "somebody else is
       * working on this", and without this column that work would be unfindable: the row would say
       * "processing" and nothing would say by what.
       *
       * That matters more here than it would in most systems. This table exists because "Queues has no
       * queryable history" — the product's own thesis applied to its own machinery — and a decision that is
       * running is exactly the state an operator asks about. The value is what
       * "wrangler workflows instances describe" takes.
       *
       * (Note the quotes rather than backticks: a backtick in a prose comment INSIDE a sql template closes
       * the template, and the error lands on a line of English. AGENTS.md's first recorded trap, and I just
       * walked into it.)
       */
      workflow_instance_id text
    )
  `

  /*
   * For databases created before the column existed.
   *
   * The "0015_rule_conditions" pattern: the definition above is authoritative and this file is re-applied
   * under a new key, rather than editing an applied migration in place and leaving every existing database
   * on the old shape. "add column if not exists" makes re-running a no-op.
   */
  yield* sql`
    alter table events add column if not exists workflow_instance_id text
  `

  yield* sql`
    create unique index if not exists events_org_idempotency_idx
      on events (organization_id, idempotency_key)
  `

  // the sweeper's index: queued rows, oldest first
  yield* sql`
    create index if not exists events_queued_idx
      on events (status, created_at)
      where status = 'queued'
  `

  yield* sql`
    create index if not exists events_org_created_idx
      on events (organization_id, created_at desc)
  `
})
