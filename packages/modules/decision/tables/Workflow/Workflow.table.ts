/**
 * workflow_executions and workflow_activities: the memo that makes retries cheap.
 *
 * **These rows are not telemetry — they are the audit trail**, and that is why they live in Postgres
 * rather than in a Durable Object's private storage (ADR-0003). workflow_activities holds each step's
 * result, which for the extraction step means the extracted invoice fields: it has to be queryable
 * beside the decision it produced, and RLS-scoped like everything else it contains.
 *
 * The primary key on activities is the whole design: (execution_id, name, attempt). A hit means the
 * step already ran and its outcome is known; a miss means run it. That is the entire memo.
 */
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export const WorkflowTable = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    create table if not exists workflow_executions (
      -- Supplied by the caller and derived from the work, never generated: the same document decided
      -- twice must land on the same execution id, or the memo is useless.
      execution_id     text primary key,
      organization_id  text not null,
      workflow_name    text not null,
      payload          jsonb not null,
      /*
       * The encoded Workflow.Result once the run completes. Null while running.
       *
       * Stored as { kind: 'success' | 'failure', value } rather than a serialised Exit, because the
       * engine works at the encoded level and a hand-rolled envelope is one obvious thing rather than
       * a dependency on Exit's wire shape.
       */
      result           jsonb,
      started_at       timestamptz not null default now(),
      completed_at     timestamptz
    )
  `

  yield* sql`
    create table if not exists workflow_activities (
      execution_id  text not null references workflow_executions(execution_id) on delete cascade,
      -- The activity's name from the workflow definition. Stable across deploys by construction:
      -- renaming an activity invalidates its memo, which is correct — it is a different step.
      name          text not null,
      attempt       integer not null,
      organization_id text not null,
      -- Same envelope as above. A defect is NEVER stored: re-running a defect is either harmless
      -- (a bug fails again) or exactly what you want (a transient network failure).
      result        jsonb not null,
      completed_at  timestamptz not null default now(),
      primary key (execution_id, name, attempt)
    )
  `

  yield* sql`
    create index if not exists workflow_executions_org_idx
      on workflow_executions (organization_id, started_at desc)
  `

  for (const table of ["workflow_executions", "workflow_activities"]) {
    yield* sql`alter table ${sql.literal(table)} enable row level security`
    yield* sql`alter table ${sql.literal(table)} force row level security`
    yield* sql`drop policy if exists ${sql.literal(`${table}_tenant`)} on ${sql.literal(table)}`
    yield* sql`
      create policy ${sql.literal(`${table}_tenant`)} on ${sql.literal(table)}
        using (organization_id = current_org())
        with check (organization_id = current_org())
    `
    yield* sql`grant select, insert, update, delete on ${sql.literal(table)} to effect_ai_app`
  }
})
