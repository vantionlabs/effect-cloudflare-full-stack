/**
 * Which embedding model produced a vector, recorded rather than assumed.
 *
 * `effect/ai`'s `EmbeddingModel` is the port that produces vectors; this is the metadata that has to
 * be **stored on the row**, and it is separate because the two have different lifetimes. A vector is
 * only comparable to other vectors from the same model — different models occupy different spaces —
 * so `document_chunks.embedding_model` is what makes a corpus interpretable a year later, and what
 * lets a re-embed run find the chunks that still need doing.
 *
 * **Changing the model is a data migration, not a config edit** (docs/runbooks/ReEmbed.md). The
 * column width is fixed in DDL from `EMBEDDING_DIMENSIONS`, and `IndexPolicyDocument` refuses a
 * profile whose width disagrees — otherwise a mismatch surfaces as a Postgres error on the first
 * insert of a long re-index rather than at startup.
 */
import { Context } from "effect"

export interface EmbeddingProfileValue {
  /** Stored verbatim on every chunk, e.g. `mistral-embed`. */
  readonly modelId: string
  /** Must equal `EMBEDDING_DIMENSIONS`; asserted where chunks are written. */
  readonly dimensions: number
  /**
   * Whether these vectors carry real semantic meaning.
   *
   * False for the deterministic development embedder. It exists so the pipeline runs with no API key,
   * but its vectors are content-addressed noise — so anything that *reports* retrieval quality must
   * say so rather than presenting a lexical-plus-noise number as a hybrid one. A benchmark that
   * flatters itself is worse than no benchmark.
   */
  readonly semantic: boolean
}

export class EmbeddingProfile extends Context.Service<EmbeddingProfile, EmbeddingProfileValue>()(
  "policy/EmbeddingProfile"
) {}
