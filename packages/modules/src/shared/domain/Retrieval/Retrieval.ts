/**
 * The contract between `policy` and `decision`: what a retrieval returns, and under which mode.
 *
 * In `shared/domain` because two slices meet here and neither owns the boundary. `policy` produces
 * these values; `decision` consumes them, stores `retrieval_mode` on the row, and reads it in rail 4.
 * `dep:check` caught the direct import and it was right to: a type two slices depend on is a shared
 * type whether or not anyone decided that.
 *
 * The split that leaves behind: **policy owns the corpus** (chunking, embedding, the SQL function),
 * **shared owns the retrieval contract**. So `EMBEDDING_DIMENSIONS` stays in policy, where nothing
 * outside it has any business knowing the vector width.
 */
import { Schema } from "effect"

export const ChunkId = Schema.String.pipe(Schema.brand("ChunkId"))
export type ChunkId = typeof ChunkId.Type

/**
 * Which halves of hybrid retrieval actually ran.
 *
 * Recorded on every decision, because **a decision made on degraded retrieval is not the same
 * decision.** `auto_approve` requires `hybrid` (rail 4): degraded retrieval that nobody can see is
 * exactly the failure this problem shape keeps producing.
 */
export const RetrievalMode = Schema.Literals(["hybrid", "lexical", "semantic", "none"])
export type RetrievalMode = typeof RetrievalMode.Type

/** One chunk as retrieval returns it, with the ranks that produced its score. */
export class RetrievedChunk extends Schema.Class<RetrievedChunk>("RetrievedChunk")({
  chunk_id: ChunkId,
  document_id: Schema.String,
  heading: Schema.NullOr(Schema.String),
  /** The citable reference, e.g. "Artikel 3.2". Null when the source had no numbering. */
  clause_ref: Schema.NullOr(Schema.String),
  /** The text a citation must quote from, checked by rail 2 with `containsVerbatim`. */
  content: Schema.String,
  score: Schema.Finite,
  /** Null when this chunk did not appear in that half's candidates. */
  semantic_rank: Schema.NullOr(Schema.Int),
  lexical_rank: Schema.NullOr(Schema.Int),
  /**
   * The document's name — the manual a mechanic would go and fetch. Looked up by `RetrievePolicy`, not carried by
   * the SQL function, so it needed no change to `retrieve_policy`'s return type.
   *
   * Optional because a Workflow step's stored retrieval predates it: an instance memoised before this field
   * existed must still read, and "unknown document" is the honest reading of one.
   */
  document_title: Schema.optional(Schema.NullOr(Schema.String))
}) {}

export class Retrieval extends Schema.Class<Retrieval>("Retrieval")({
  chunks: Schema.Array(RetrievedChunk),
  mode: RetrievalMode
}) {}
