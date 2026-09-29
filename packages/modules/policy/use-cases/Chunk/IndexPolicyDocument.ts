/**
 * Indexing a policy document: chunk it, embed it, write it.
 *
 * Ordering and failure behaviour, both chosen so a partial run leaves something usable:
 *
 *   1. **Chunk, then embed, then write — in one transaction.** A half-written corpus is worse than an
 *      unindexed one: retrieval would return some clauses and silently miss others, and the product's
 *      claim is that every applicable rule was considered.
 *   2. **The embedder's width is checked before anything is written.** A profile disagreeing with
 *      `EMBEDDING_DIMENSIONS` otherwise fails at the first `insert`, which on a large re-index means
 *      discovering it minutes in.
 *   3. **An embedding failure does NOT fail the index.** Chunks are written with a null vector, which
 *      is lexically retrievable. That is what makes an embedding outage a degradation rather than an
 *      outage — and `retrieval_mode` is what makes the degradation visible instead of silent.
 *
 * Re-indexing replaces the document's chunks rather than adding to them, so running it twice is safe.
 */
import { EMBEDDING_DIMENSIONS } from "@ea/modules/policy/domain/Chunk"
import { Chunker, embeddableText } from "@ea/modules/policy/domain/Chunk"
import { EmbeddingProfile } from "@ea/modules/policy/domain/Embedding"
import { Ids } from "@ea/modules/shared/domain/Ids"
import { Db } from "@ea/modules/shared/tables/Database"
import { Effect, Schema } from "effect"
import { EmbeddingModel } from "effect/ai"

/** Raised before any write when the configured embedder does not match the column width. */
export class EmbeddingWidthMismatch extends Schema.TaggedError<EmbeddingWidthMismatch>()(
  "EmbeddingWidthMismatch",
  { modelId: Schema.String, expected: Schema.Int, actual: Schema.Int }
) {}

export interface IndexPolicyDocumentInput {
  readonly documentId: string
  readonly title: string
  readonly text: string
  readonly collection: "policy" | "transactional"
}

export interface IndexPolicyDocumentResult {
  readonly chunks: number
  readonly embedded: number
}

export const IndexPolicyDocument = (input: IndexPolicyDocumentInput) =>
  Effect.gen(function*() {
    const db = yield* Db
    const ids = yield* Ids
    const profile = yield* EmbeddingProfile
    // The PORT, so the chunking strategy is a composition choice the recall gate can vary.
    const chunker = yield* Chunker
    const model = yield* EmbeddingModel.EmbeddingModel

    // (2): refuse before writing, not on the first insert.
    if (profile.dimensions !== EMBEDDING_DIMENSIONS) {
      return yield* Effect.fail(
        new EmbeddingWidthMismatch({
          modelId: profile.modelId,
          expected: EMBEDDING_DIMENSIONS,
          actual: profile.dimensions
        })
      )
    }

    const chunks = yield* chunker.chunk(input.text, { title: input.title })
    if (chunks.length === 0) return { chunks: 0, embedded: 0 }

    /*
     * (3): an embedding failure degrades rather than fails.
     *
     * `Effect.option` rather than a retry here: the caller is a queue consumer with its own retry
     * policy, and a chunk written without a vector is recoverable by a re-embed run — whereas
     * refusing the whole document leaves the corpus with nothing at all for it.
     */
    const embeddings = yield* Effect.option(
      Effect.map(
        model.embedMany(chunks.map(embeddableText)),
        (response) => response.embeddings.map((entry) => entry.vector)
      )
    )

    const vectors = embeddings._tag === "Some" ? embeddings.value : undefined

    yield* db.scoped((sql, orgId) =>
      Effect.gen(function*() {
        // Replace rather than append: re-indexing must be idempotent, and a stale chunk that is
        // still retrievable is a citation to policy that no longer exists.
        yield* sql`delete from document_chunks where document_id = ${input.documentId}`

        for (const [index, chunk] of chunks.entries()) {
          const vector = vectors?.[index]
          yield* sql`
            insert into document_chunks (
              id, organization_id, document_id, collection, ordinal, heading, clause_ref,
              content, context_prefix, embedding, embedding_model, embedded_at
            ) values (
              ${yield* ids.next}, ${orgId}, ${input.documentId}, ${input.collection},
              ${chunk.ordinal}, ${chunk.heading}, ${chunk.clauseRef},
              ${chunk.content}, ${chunk.contextPrefix},
              ${vector === undefined ? null : `[${vector.join(",")}]`},
              ${vector === undefined ? null : profile.modelId},
              ${vector === undefined ? null : new Date()}
            )
          `
        }
      })
    )

    return { chunks: chunks.length, embedded: vectors === undefined ? 0 : chunks.length }
  })
