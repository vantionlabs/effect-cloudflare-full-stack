/**
 * What the agent reports while it works.
 *
 * Two frames and no more. `Searching` is what a reader is waiting through — a four-step loop is four model
 * calls and four retrievals — and `Answered` arrives once, whole, and already verified.
 *
 * **There is deliberately no `Token` or `Chunk` frame.** The answer's prose cannot be streamed: its citations
 * are only checkable once the answer is complete, so streaming text first means an unverifiable claim has been
 * read by the time it is refused, and a retraction after the fact is not a refusal. Grounding and
 * token-streaming the same text are mutually exclusive; this codebase sells the first one.
 */
import { Schema } from "effect"
import { AskAnswerCitation } from "./AskAnswer.ts"

export class Searching extends Schema.TaggedClass<Searching>()("Searching", {
  /** The model's own query text. Shown because "what is it looking for" is the useful part of waiting. */
  query: Schema.String,
  /**
   * The retrieval mode the search ran in, or null before one has completed.
   *
   * Surfaced for the same reason the decide path records it: an answer built on degraded retrieval is a weaker
   * answer, and a reader should be told while it is happening rather than after.
   */
  retrieval_mode: Schema.NullOr(Schema.String)
}) {}

export class Answered extends Schema.TaggedClass<Answered>()("Answered", {
  answer: Schema.String,
  citations: Schema.Array(AskAnswerCitation),
  steps: Schema.Int,
  truncated: Schema.Boolean
}) {}

export const AskProgress = Schema.Union([Searching, Answered])
export type AskProgress = typeof AskProgress.Type
