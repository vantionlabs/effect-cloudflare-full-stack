/**
 * `document_chunks`: the policy corpus, its lexical index and its vector index in one table.
 *
 * One store rather than two is the decision this whole data layer turned on. Two stores — a vector
 * database beside Postgres — means partial ingest, an `embedded_at IS NULL` reconciliation query, and
 * an ordering rule between them. For a product whose claim is that every citation is auditable, "the
 * vector store and the text store disagree" is the worst available failure class.
 *
 * Three things here are load-bearing:
 *
 * 1. **`tsv` is a GENERATED column.** Derived data that a writer could forget to update is derived
 *    data that will eventually be wrong. Postgres recomputes it on every write, so the lexical index
 *    cannot drift from the content it indexes.
 * 2. **`embedded_at` and `embedding` are NULLABLE.** A chunk without a vector is still retrievable
 *    lexically. That is what makes an embedding-model swap a *degradation* rather than an outage, and
 *    it is why `retrieval_mode` is recorded rather than assumed.
 * 3. **`to_tsvector('dutch', …)` is real Snowball stemming**, so "verplichting" matches
 *    "verplichtingen". This is free in Postgres and hand-rolled anywhere else; it is a large part of
 *    why the corpus lives here.
 */
import { EMBEDDING_DIMENSIONS } from "@ea/modules/policy/domain/Chunk"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export const ChunkTable = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    create table if not exists document_chunks (
      id               text primary key,
      -- No FK to better-auth's organization table; see Tenancy.table.ts.
      organization_id  text not null,
      document_id      text not null references source_documents(id) on delete cascade,
      -- The corpus separation, as a constraint rather than a convention. A transactional document
      -- must never be citable as policy, and the retrieval function filters on this column.
      collection       text not null check (collection in ('policy', 'transactional')),
      -- Position within the document, so a citation can be shown in context.
      ordinal          integer not null,
      heading          text,
      /*
       * The citable reference lifted out of the heading, e.g. "Artikel 3.2".
       *
       * Exists now, unused until slice 1.5, because the obligations index fetches applicable rules
       * BY ID rather than by ranking — which is what lets the product say "these rules applied and
       * every one was considered". Adding the column later would mean re-chunking the corpus.
       */
      clause_ref       text,
      -- Whether this clause is currently in force. Superseded policy stays for audit, not for use.
      in_force         boolean not null default true,
      -- What a citation must quote from, and what containsVerbatim checks against.
      content          text not null,
      /*
       * The heading path prepended to the content before embedding.
       *
       * Stored rather than recomputed because it is part of what was embedded: a vector is only
       * interpretable against the exact text that produced it, and a chunker change would otherwise
       * silently alter the meaning of vectors already in the table.
       */
      context_prefix   text not null default '',
      embedding        vector(${sql.literal(String(EMBEDDING_DIMENSIONS))}),
      -- Which model produced the vector. Null together with the vector itself.
      embedding_model  text,
      -- Null means "not embedded yet or no longer valid": retrievable lexically, not semantically.
      embedded_at      timestamptz,
      created_at       timestamptz not null default now(),
      -- Generated, so the lexical index cannot drift from the content. The heading is included
      -- because a query naming a clause by its title should find it.
      tsv              tsvector generated always as (
                         to_tsvector('dutch', coalesce(heading, '') || ' ' || content)
                       ) stored,
      unique (document_id, ordinal)
    )
  `

  yield* sql`
    create index if not exists document_chunks_tsv_idx
      on document_chunks using gin (tsv)
  `

  /*
   * HNSW with cosine distance, matching the cosine-distance operator the retrieval function uses. An index
   * built for a different operator class is silently not used — the query still returns correct rows,
   * just by sequential scan, so this is a performance cliff rather than a wrong answer.
   */
  yield* sql`
    create index if not exists document_chunks_embedding_idx
      on document_chunks using hnsw (embedding vector_cosine_ops)
  `

  yield* sql`
    create index if not exists document_chunks_org_collection_idx
      on document_chunks (organization_id, collection, in_force)
  `

  yield* sql`alter table document_chunks enable row level security`
  yield* sql`alter table document_chunks force row level security`
  yield* sql`drop policy if exists document_chunks_tenant on document_chunks`
  yield* sql`
    create policy document_chunks_tenant on document_chunks
      using (organization_id = current_org())
      with check (organization_id = current_org())
  `

  yield* sql`grant select, insert, update, delete on document_chunks to effect_ai_app`
})
