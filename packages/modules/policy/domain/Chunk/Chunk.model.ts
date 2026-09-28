/**
 * A retrievable piece of the policy corpus.
 *
 * The corpus is what decisions are justified *against*, which is why `collection` lives on the row
 * and inside the retrieval function rather than at call sites: a transactional document must never be
 * citable as policy, and "remember to filter" is not a guarantee.
 */
import { Schema } from "effect"

export const ChunkId = Schema.String.pipe(Schema.brand("ChunkId"))
export type ChunkId = typeof ChunkId.Type

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

/**
 * Which halves of hybrid retrieval actually ran.
 *
 * Recorded on every decision, because **a decision made on degraded retrieval is not the same
 * decision.** `auto_approve` requires `hybrid` (rail 4): degraded retrieval that nobody can see is
 * exactly the failure this problem shape keeps running into.
 */
export const RetrievalMode = Schema.Literals(["hybrid", "lexical", "semantic", "none"])
export type RetrievalMode = typeof RetrievalMode.Type

/** One chunk as retrieval returns it, with the ranks that produced its score. */
export class RetrievedChunk extends Schema.Class<RetrievedChunk>("RetrievedChunk")({
  chunk_id: ChunkId,
  document_id: Schema.String,
  heading: Schema.NullOr(Schema.String),
  /** The citable reference, e.g. `Artikel 3.2`. Null when the source had no numbering. */
  clause_ref: Schema.NullOr(Schema.String),
  /** The text a citation must quote from. */
  content: Schema.String,
  score: Schema.Finite,
  /** Null when this chunk did not appear in that half's candidates. */
  semantic_rank: Schema.NullOr(Schema.Int),
  lexical_rank: Schema.NullOr(Schema.Int)
}) {}

/** What a retrieval returned, and under which mode it ran. */
export class Retrieval extends Schema.Class<Retrieval>("Retrieval")({
  chunks: Schema.Array(RetrievedChunk),
  mode: RetrievalMode
}) {}
