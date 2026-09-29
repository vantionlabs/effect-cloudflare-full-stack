/**
 * `retrieve_policy`: hybrid search as one SQL function, and the only way to query the corpus.
 *
 * Reciprocal Rank Fusion over two CTEs — cosine distance on the HNSW index, and `ts_rank_cd` on the
 * Dutch GIN index — combined in one round trip. That single fact is most of why the corpus lives in
 * Postgres: on a two-store design the halves are fused in application code, which means a partial
 * failure mode where the vector half is down and retrieval silently degrades to lexical without
 * anyone noticing. Here either both halves ran or the query failed.
 *
 * **Why RRF rather than combining scores.** Cosine distance and `ts_rank_cd` are not on a common
 * scale and their distributions differ per query, so any weighted sum of the raw scores is
 * arbitrary. RRF uses only the *ranks*, which is scale-free: a chunk ranked 1st by either half
 * contributes `1/(k+1)` regardless of how the underlying numbers happened to fall.
 *
 * **Three things this function must get right, and one it must not do:**
 *
 * - `security invoker` remains stated explicitly. It mattered enormously under RLS, where `security
 *   definer` would have run as the owner and bypassed every policy. With the filter now a parameter it
 *   matters less, and it is kept because a future reader restoring RLS should not have to rediscover it.
 * - The org is a PARAMETER now, not `current_org()`. It was a GUC read by both this function and the RLS
 *   policies; with RLS removed the GUC has no other reader, and an invisible filter is worse than an
 *   argument. `Db.scoped` still supplies it, so a caller cannot name a tenant.
 * - `collection` is filtered here rather than at call sites, so a transactional document cannot be
 *   retrieved as policy even by a caller who forgot.
 * - It does **not** decide the retrieval mode. It returns the per-half ranks and lets the caller
 *   conclude, because "which halves actually ran" is a fact the decision records and must not be
 *   inferred from a NULL by two different pieces of code.
 */
import { EMBEDDING_DIMENSIONS } from "@ea/modules/policy/domain/Chunk"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export const RetrievalTable = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  const dimensions = sql.literal(String(EMBEDDING_DIMENSIONS))

  /*
   * Dropped before creating, because the SIGNATURE changed.
   *
   * `create or replace function` replaces only a function with the same argument list. Adding
   * `p_organization_id` would have created an OVERLOAD, leaving the old `current_org()`-filtered version
   * callable — and after RLS is removed that version returns every tenant's policy. A stale overload is a
   * far worse outcome than a failed migration.
   */
  yield* sql`
    drop function if exists retrieve_policy(text, vector, text, integer, integer, double precision, double precision, integer)
  `

  yield* sql`
    create or replace function retrieve_policy(
      p_query       text,
      p_embedding   vector(${dimensions}),
      p_collection  text,
      /*
       * The organization, passed explicitly.
       *
       * This was current_org() reading a transaction-local GUC, which RLS policies also read. With RLS
       * removed the GUC has no other reader, and an implicit filter nobody can see in the call is worse than
       * a parameter — so the tenant is now an argument. A caller still cannot choose it freely: Db.scoped
       * supplies it from the session and there is no overload taking one.
       */
      p_organization_id text,
      p_limit       integer,
      -- The RRF constant. 60 is the value from the original paper and the de facto default; it
      -- flattens the contribution curve so ranks 1 and 2 are not wildly far apart.
      p_k           integer default 60,
      p_weight_semantic double precision default 1.0,
      p_weight_lexical  double precision default 1.0,
      -- How deep each half looks before fusing. Larger costs little and materially improves recall,
      -- because a chunk ranked 40th by one half can still win on fusion.
      p_candidates  integer default 60
    )
    returns table (
      chunk_id      text,
      document_id   text,
      heading       text,
      clause_ref    text,
      content       text,
      score         double precision,
      semantic_rank integer,
      lexical_rank  integer
    )
    language sql
    stable
    parallel safe
    -- See the module docstring: security definer here would bypass RLS for every tenant.
    security invoker
    as $$
      with query as (
        /*
         * The query as an OR of its lexemes, lexed with the SAME Dutch configuration as the column.
         *
         * Not websearch_to_tsquery, and this is the single most consequential line in the file.
         * That function ANDs every term, so one word absent from a clause means no match at all:
         * "wie mag verplichtingen aangaan namens de organisatie" fails against a clause containing
         * "namens de organisatie verplichtingen aangaan", because "mag" is not a Dutch stopword and
         * does not appear in it. Measured cost of the AND form on the gold set: lexical recall@8
         * fell from 92% to 31%, and nothing downstream would have reported it — the review queue
         * would simply have been full.
         *
         * OR semantics with ts_rank_cd is what retrieval wants: matching more terms, and matching
         * them closer together, ranks higher, while matching only some still ranks at all.
         */
        select nullif(
                 array_to_string(
                   tsvector_to_array(to_tsvector('dutch', p_query)),
                   ' | '
                 ),
                 ''
               )::tsquery as tsq
      ),
      semantic as (
        select
          c.id,
          row_number() over (order by c.embedding <=> p_embedding)::integer as rank
        from document_chunks c
        where c.organization_id = p_organization_id
          and c.collection = p_collection
          and c.in_force
          and c.embedding is not null
          and p_embedding is not null
        order by c.embedding <=> p_embedding
        limit p_candidates
      ),
      lexical as (
        select
          c.id,
          row_number() over (order by ts_rank_cd(c.tsv, q.tsq) desc)::integer as rank
        from document_chunks c, query q
        where c.organization_id = p_organization_id
          and c.collection = p_collection
          and c.in_force
          and c.tsv @@ q.tsq
        order by ts_rank_cd(c.tsv, q.tsq) desc
        limit p_candidates
      )
      select
        c.id,
        c.document_id,
        c.heading,
        c.clause_ref,
        c.content,
        coalesce(1.0 / (p_k + s.rank), 0) * p_weight_semantic
          + coalesce(1.0 / (p_k + l.rank), 0) * p_weight_lexical as score,
        s.rank,
        l.rank
      from document_chunks c
      left join semantic s on s.id = c.id
      left join lexical  l on l.id = c.id
      where c.organization_id = p_organization_id
        and (s.id is not null or l.id is not null)
      -- id as a tiebreak so equal scores return in a stable order; a retrieval that reshuffles
      -- between identical calls makes an eval run unreproducible.
      order by score desc, c.id
      limit p_limit
    $$
  `
})
