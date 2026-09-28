/**
 * The first tenant-scoped table, with row-level security.
 *
 * `source_documents` exists now — ahead of the decision pipeline — because it is the smallest
 * real table that proves the tenancy mechanism end to end. Everything after it follows the same
 * three-part shape:
 *
 *   1. `organization_id` on every row, NOT NULL.
 *   2. `enable row level security` plus a policy keyed on `current_org()`.
 *   3. `force row level security`, so even the table owner is subject to it.
 *
 * Point 3 matters more than it looks: without it, RLS silently does nothing whenever the app
 * connects as the table's owner, and the policies read as protection while providing none.
 */
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export const DocumentTable = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    create table if not exists source_documents (
      id               text primary key,
      -- No FK to better-auth's organization table: a cross-boundary reference would turn
      -- their schema upgrade into our migration problem (plan risk R9). The guard is RLS
      -- plus the type-level seam in Db.ts, not referential integrity.
      organization_id  text not null,
      -- The policy corpus is kept strictly separate from the documents being decided. A
      -- CHECK-constrained column plus a filter inside the retrieval function means a
      -- transactional document can never be cited as policy.
      collection       text not null check (collection in ('policy', 'transactional')),
      filename         text not null,
      -- R2 object key. Unique so the same upload cannot be registered twice.
      r2_key           text not null unique,
      content_type     text not null,
      size_bytes       bigint,
      status           text not null default 'uploaded'
                         check (status in ('pending_upload', 'uploaded', 'processing', 'ready', 'failed')),
      error            text,
      created_at       timestamptz not null default now(),
      updated_at       timestamptz not null default now()
    )
  `

  yield* sql`
    create index if not exists source_documents_org_collection_idx
      on source_documents (organization_id, collection, created_at desc)
  `

  yield* sql`alter table source_documents enable row level security`
  // Applies the policy to the owner too. Without this, connecting as the owner bypasses RLS
  // entirely and the policy below is decoration.
  yield* sql`alter table source_documents force row level security`

  yield* sql`drop policy if exists source_documents_tenant on source_documents`
  yield* sql`
    create policy source_documents_tenant on source_documents
      using (organization_id = current_org())
      with check (organization_id = current_org())
  `

  // `using` filters reads; `with check` constrains writes. Both are required: without the
  // second, a tenant could INSERT a row attributed to another organization and then be unable
  // to see it — data written into a tenant that never consented to it.

  yield* sql`grant select, insert, update, delete on source_documents to effect_ai_app`
})
