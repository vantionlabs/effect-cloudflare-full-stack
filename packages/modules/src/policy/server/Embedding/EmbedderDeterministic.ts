/**
 * An `EmbeddingModel` that needs no API key, for development and tests.
 *
 * **Its vectors have no semantic content.** They are a hash of the text projected onto the unit
 * sphere: stable, so a corpus indexed twice produces identical vectors and an eval run is
 * reproducible, and meaningless, so two documents about the same subject are no closer than two
 * about different ones.
 *
 * That is stated in `EmbeddingProfile.semantic = false` rather than left to the reader, because the
 * temptation it creates is specific and costly: measure recall with this, see a plausible number, and
 * conclude hybrid retrieval works. It would be measuring lexical retrieval plus noise. Anything
 * reporting retrieval quality reads that flag and refuses to present a semantic figure.
 *
 * It ships in `server/` for the same reason the scripted language model does: `wrangler dev` with no
 * keys should index a corpus and serve a query end to end.
 */
import { EMBEDDING_DIMENSIONS } from "@ea/modules/policy/domain/Chunk"
import { EmbeddingProfile } from "@ea/modules/policy/domain/Embedding"
import { Effect, Layer } from "effect"
import { EmbeddingModel } from "effect/ai"

/**
 * FNV-1a, seeded per output position.
 *
 * A hash rather than a random vector because the same text must always embed identically: a
 * re-indexed corpus that shifted would make every stored distance meaningless and every eval run
 * unrepeatable.
 */
const hashAt = (text: string, position: number): number => {
  let hash = 0x811c9dc5 ^ position
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  // Map to [-1, 1). The sign matters: an all-positive vector makes cosine distance nearly constant.
  return ((hash >>> 0) / 0x80000000) - 1
}

const embedOne = (text: string): Array<number> => {
  const raw = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, position) => hashAt(text, position))
  // Normalised, because the corpus is queried with cosine distance and pgvector does not normalise
  // for you. Unnormalised vectors would make magnitude a confounder.
  const norm = Math.hypot(...raw) || 1
  return raw.map((value) => value / norm)
}

export const EmbedderDeterministic: Layer.Layer<EmbeddingModel.EmbeddingModel | EmbeddingProfile> = Layer.merge(
  Layer.effect(EmbeddingModel.EmbeddingModel)(
    EmbeddingModel.make({
      embedMany: (options) =>
        Effect.succeed({
          results: options.inputs.map(embedOne),
          usage: { inputTokens: undefined }
        })
    })
  ),
  Layer.succeed(EmbeddingProfile)({
    modelId: "deterministic-hash-v1",
    dimensions: EMBEDDING_DIMENSIONS,
    // The whole point of this flag. See the module docstring.
    semantic: false
  })
)
