/**
 * What an answer IS, separate from the RPCs that carry it.
 *
 * In its own file because `AskProgress` needs the citation type and `AskRpcs` needs both — and a cycle between
 * two schema files does not fail as a cycle. It fails at import time with
 * `Cannot read properties of undefined (reading 'ast')` from inside `Schema`, pointing at the class being
 * defined rather than at the import that was not ready. Worth knowing once.
 */
import { Schema } from "effect"

/** A clause the answer relied on. Verified before it reaches here — see `ungroundedCitations`. */
export class AskAnswerCitation extends Schema.Class<AskAnswerCitation>("AskAnswerCitation")({
  chunk_id: Schema.String,
  clause_ref: Schema.NullOr(Schema.String),
  excerpt: Schema.String
}) {}

export class AskAnswer extends Schema.Class<AskAnswer>("AskAnswer")({
  answer: Schema.String,
  /**
   * The clauses relied on, every one verified against what the search actually returned.
   *
   * Published rather than kept server-side because a reviewer has to be able to check the answer — the same
   * argument as a decision's citations, and the reason this surface was not allowed to stay prose-only. The
   * console can highlight an excerpt with `containsVerbatim`, which is the function that verified it.
   */
  citations: Schema.Array(AskAnswerCitation),
  /** How many model calls it took. Surfaced so a loop that always hits its bound is visible in the UI. */
  steps: Schema.Int,
  /** True when the step bound stopped it. The answer is then partial and the console must say so. */
  truncated: Schema.Boolean
}) {}
