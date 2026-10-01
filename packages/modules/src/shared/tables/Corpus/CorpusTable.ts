/**
 * Widens both collection constraints for `knowledge` (technical documentation). See `Collection.ts` for why it is
 * a collection of its own rather than more `policy`.
 *
 * Drop-and-re-add by the constraints' real names (read from `pg_constraint`), because a `check` cannot be altered
 * with `if not exists`. Expand-only: running code never writes `knowledge`, so this is safe before the deploy.
 */
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export const CorpusKnowledge = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  yield* sql`alter table source_documents drop constraint if exists source_documents_collection_check`
  yield* sql`
    alter table source_documents add constraint source_documents_collection_check
      check (collection in ('policy', 'transactional', 'knowledge'))
  `
  yield* sql`alter table document_chunks drop constraint if exists document_chunks_collection_check`
  yield* sql`
    alter table document_chunks add constraint document_chunks_collection_check
      check (collection in ('policy', 'transactional', 'knowledge'))
  `
})
