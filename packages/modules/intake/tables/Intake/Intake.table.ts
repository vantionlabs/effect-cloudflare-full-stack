/**
 * `intakes`: the record that a document arrived, and how.
 *
 * Separate from `source_documents` because they answer different questions. A document is a
 * thing that exists; an intake is an *event* that happened — the same file can arrive twice, by
 * different routes, and the audit trail should say so rather than silently deduplicate.
 *
 * `external_ref` is unique **per organization**, not globally. docket made it global, which
 * leaks one tenant's reference into another's error message ("already exists") — a small but
 * real cross-tenant disclosure.
 */
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export const IntakeTable = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    create table if not exists intakes (
      id               text primary key,
      -- No FK to better-auth's organization table; see 0001_tenancy.
      organization_id  text not null,
      -- How the document arrived. A closed set: an unrecognised source must not be storable,
      -- because the audit trail is only as good as its vocabulary.
      source           text not null check (source in ('upload', 'webhook', 'schedule', 'email')),
      -- The sender's own identifier, when it has one. Makes a redelivered webhook idempotent.
      external_ref     text,
      document_id      text not null references source_documents(id) on delete cascade,
      -- Whoever submitted it. Nullable because a webhook or schedule has no user.
      created_by       text,
      received_at      timestamptz not null default now(),
      -- The original payload, for answering "what exactly did they send us" a year later.
      raw              jsonb
    )
  `

  yield* sql`
    create index if not exists intakes_org_received_idx
      on intakes (organization_id, received_at desc)
  `

  // Per-organization, and partial so the many NULL external_refs (uploads) do not collide.
  yield* sql`
    create unique index if not exists intakes_org_external_ref_idx
      on intakes (organization_id, external_ref)
      where external_ref is not null
  `

  yield* sql`alter table intakes enable row level security`
  yield* sql`alter table intakes force row level security`
  yield* sql`drop policy if exists intakes_tenant on intakes`
  yield* sql`
    create policy intakes_tenant on intakes
      using (organization_id = current_org())
      with check (organization_id = current_org())
  `

  yield* sql`grant select, insert, update, delete on intakes to effect_ai_app`
})
