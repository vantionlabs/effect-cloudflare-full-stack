/**
 * `executions`: the claim, the call, and the one failure that cannot be closed.
 *
 * Execution state lives here rather than as a `decisions.status` value, deliberately. A status enum mixing
 * "what we decided" with "what we did about it" makes every query about one of them ambiguous — and this
 * table has a different shape anyway: one decision can be attempted more than once.
 *
 * ## The claim
 *
 * `idempotency_key` is UNIQUE per organization, and claiming is a single statement:
 *
 *   insert ... on conflict (organization_id, idempotency_key) do nothing returning id
 *
 * Zero rows returned means **somebody else owns it**. Not "try again" — owns it. That is the whole
 * concurrency control: no advisory lock, no SELECT-then-INSERT race, no TTL to tune. Two reviewers
 * clicking approve in two tabs produce one row, and the loser learns it did not win.
 *
 * ## The failure that cannot be closed
 *
 * `status = 'pending'` with the adapter call already made is **ambiguous**: the call may have succeeded
 * while the recording write was lost. No transaction helps, because the outbound call is outside any
 * database. So:
 *
 *   - `provider_idempotency_key` is sent to the provider as ITS dedupe key, which is the only real fix;
 *   - an ambiguous `pending` is **never auto-retried** — it becomes a human's problem, and the decision is
 *     marked `needs_attention`;
 *   - a cron REPORTS stuck claims to an operator view and must not resolve them.
 *
 * Getting this wrong pays a supplier twice, which is why the column exists before any adapter needs it.
 */
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export const ExecutionTable = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    create table if not exists executions (
      id               text primary key,
      -- No FK to better-auth's organization table; see Tenancy.table.ts.
      organization_id  text not null,
      decision_id      text not null references decisions(id) on delete cascade,
      -- What was done. A closed set, because an unrecognised action must not be executable.
      action           text not null check (action in ('dry_run', 'post_to_ledger', 'schedule_payment')),
      /*
       * Derived: decision:<decisionId>:<action>. The SAME key is used for the events row, so a retry at
       * either layer lands on one identity.
       */
      idempotency_key  text not null,
      /*
       * Sent to the provider as its own dedupe key.
       *
       * Present from day one even though DryRunAdapter ignores it, because retrofitting it means every
       * adapter written before it is unsafe with auto-approve armed — and that is a product rule, not an
       * engineering preference. See docs/adr/0013.
       */
      provider_idempotency_key text not null,
      status           text not null default 'pending' check (
                         status in ('pending', 'succeeded', 'failed', 'needs_attention')
                       ),
      -- Whatever the adapter reports back, for reconciliation and for the reviewer's audit view.
      response         jsonb,
      error            text,
      -- Who caused this. Null for an auto-approved decision, which is itself the audit record.
      approved_by      text,
      claimed_at       timestamptz not null default now(),
      finished_at      timestamptz
    )
  `

  yield* sql`
    create unique index if not exists executions_org_idempotency_idx
      on executions (organization_id, idempotency_key)
  `

  // The stuck-claim report's index: pending, oldest first. A cron reads this and tells a human.
  yield* sql`
    create index if not exists executions_pending_idx
      on executions (status, claimed_at)
      where status = 'pending'
  `

  yield* sql`
    create index if not exists executions_decision_idx
      on executions (organization_id, decision_id)
  `
})
