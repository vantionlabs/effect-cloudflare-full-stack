/**
 * decisions and decision_citations: what was decided, and what it was justified by.
 *
 * Four load-bearing choices, each fixing something docket got wrong or left open:
 *
 * 1. **decide_key is UNIQUE.** A redelivered decide message cannot produce a second decision, and the
 *    insert short-circuits **before any model call**. docket had this hole and Queues' at-least-once
 *    delivery would widen it — a duplicate decision is not just waste, it is two answers to one
 *    question with nothing saying which is authoritative.
 * 2. **There is no executed status.** Execution state lives in its own table and is joined. A status
 *    enum that mixes "what we decided" with "what we did about it" makes every query about one of
 *    them ambiguous.
 * 3. **effective_outcome is GENERATED.** A caller cannot read outcome and treat it as final by
 *    accident, because the column that is final is a different column.
 * 4. **retrieval_mode is recorded.** A decision made on degraded retrieval is not the same decision,
 *    and rail 4 refuses to auto-approve one — so the row has to say which it was, forever.
 */
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export const DecisionTable = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    create table if not exists decisions (
      id                 text primary key,
      -- No FK to better-auth's organization table; see Tenancy.table.ts.
      organization_id    text not null,
      document_id        text not null references source_documents(id) on delete cascade,
      extraction_id      text references extractions(id) on delete set null,
      vertical           text not null,
      /*
       * The idempotency key, derived and never generated: decision:<documentId>:<vertical>.
       * UNIQUE per organization, so a redelivered message hits the constraint rather than the model.
       */
      decide_key         text not null,
      outcome            text not null check (
                           outcome in ('auto_approve', 'route_for_approval', 'reject', 'needs_human')
                         ),
      -- Set when a human overrides. Null means nobody has.
      override_outcome   text check (
                           override_outcome in ('auto_approve', 'route_for_approval', 'reject', 'needs_human')
                         ),
      -- What is actually in force. Generated, so it cannot drift from the two columns it derives from.
      effective_outcome  text generated always as (coalesce(override_outcome, outcome)) stored,
      status             text not null check (
                           status in ('pending_review', 'approved', 'rejected', 'auto_approved', 'needs_attention')
                         ),
      rationale          text not null,
      -- Which rails fired, in order. Empty means the model's proposal stood unchanged.
      rails_fired        text[] not null default '{}',
      -- hybrid | lexical | semantic | none. See the module docstring, point 4.
      retrieval_mode     text not null check (retrieval_mode in ('hybrid', 'lexical', 'semantic', 'none')),
      -- Whether every extracted span verified. Rail 1 reads this; the row records it.
      grounded           boolean not null,
      model              text not null,
      decided_at         timestamptz not null default now(),
      reviewed_by        text,
      reviewed_at        timestamptz
    )
  `

  yield* sql`
    create unique index if not exists decisions_org_decide_key_idx
      on decisions (organization_id, decide_key)
  `

  yield* sql`
    create index if not exists decisions_queue_idx
      on decisions (organization_id, status, decided_at desc)
  `

  yield* sql`
    create table if not exists decision_citations (
      id              text primary key,
      organization_id text not null,
      decision_id     text not null references decisions(id) on delete cascade,
      -- The chunk relied on. No FK cascade to null: a citation whose chunk was deleted is still a
      -- record of what the decision was justified by at the time.
      chunk_id        text not null,
      clause_ref      text,
      -- The verbatim excerpt. Checked by rail 2 against the chunk content BEFORE the row is written,
      -- so a stored citation is one that verified.
      excerpt         text not null,
      ordinal         integer not null,
      unique (decision_id, ordinal)
    )
  `

  for (
    const table of ["decisions", "decision_citations"]
  ) {
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
