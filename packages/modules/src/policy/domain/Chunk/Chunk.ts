/**
 * A retrievable piece of the policy corpus.
 *
 * The corpus is what decisions are justified *against*, which is why `collection` lives on the row
 * and inside the retrieval function rather than at call sites: a transactional document must never be
 * citable as policy, and "remember to filter" is not a guarantee.
 *
 * What is NOT here: the retrieval contract (`RetrievalMode`, `RetrievedChunk`, `Retrieval`, `ChunkId`).
 * Two slices meet on those, so they live in `shared/domain/Retrieval`. This file keeps what only the
 * corpus owner needs — chiefly the vector width, which nothing outside `policy` should know.
 */

/**
 * The embedding width, in one place.
 *
 * 1024 matches `mistral-embed` and `baai/bge-m3`, the two models the provider profiles use. It is
 * imported by the migration that declares the column, so the DDL and the code cannot drift — and
 * `IndexPolicyDocument` refuses an embedder whose width disagrees, because a mismatch would otherwise
 * surface as a Postgres error on the millionth insert rather than the first.
 *
 * **Changing this is a data migration, not a constant edit.** Different models occupy different vector
 * spaces, so old vectors are not comparable to new ones — see docs/runbooks/ReEmbed.md.
 */
export const EMBEDDING_DIMENSIONS = 1024
