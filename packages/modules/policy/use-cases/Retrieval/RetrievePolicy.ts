/**
 * Hybrid retrieval, and the honest reporting of which halves actually ran.
 *
 * The fusion is `retrieve_policy`'s — one SQL function, one round trip, both halves transactionally
 * consistent. This use case does three things around it: embed the query, call the function, and
 * **conclude the retrieval mode**.
 *
 * That last one is the part worth caring about. `auto_approve` requires `mode === "hybrid"` (rail 4),
 * so the mode is not telemetry — it is an input to an authorisation decision. It is therefore derived
 * from what the query actually returned rather than from configuration: an embedder that is present
 * but returned nothing, or a corpus that is not embedded yet, both mean the semantic half did not run,
 * however the system is configured. Degraded retrieval that nobody can see is exactly the failure this
 * problem shape keeps producing.
 */
import { ChunkId, Retrieval, type RetrievalMode, RetrievedChunk } from "@ea/modules/policy/domain/Chunk"
import type { Collection } from "@ea/modules/shared/domain/Corpus"
import { Db } from "@ea/modules/shared/tables/Database"
import { Effect } from "effect"
import { EmbeddingModel } from "effect/ai"

export interface RetrievePolicyInput {
  readonly query: string
  readonly limit?: number | undefined
  /** Defaults to the policy corpus. A transactional document must be asked for explicitly. */
  readonly collection?: Collection | undefined
}

const DEFAULT_LIMIT = 8

export const RetrievePolicy = (input: RetrievePolicyInput) =>
  Effect.gen(function*() {
    const db = yield* Db
    const model = yield* EmbeddingModel.EmbeddingModel

    /*
     * A failed query embedding degrades to lexical rather than failing the retrieval.
     *
     * The alternative — failing — turns an embedding provider outage into "no decisions at all". This
     * way the decision still happens, on lexical retrieval, and rail 4 refuses to auto-approve it.
     * That is the behaviour worth having: degraded, visible, and not automatic.
     */
    const embedding = yield* Effect.option(
      Effect.map(model.embed(input.query), (response) => response.vector)
    )
    const vector = embedding._tag === "Some" ? `[${embedding.value.join(",")}]` : null

    const rows = yield* db.scoped((sql) =>
      sql<{
        chunk_id: string
        document_id: string
        heading: string | null
        clause_ref: string | null
        content: string
        score: number
        semantic_rank: number | null
        lexical_rank: number | null
      }>`
        select * from retrieve_policy(
          ${input.query},
          ${vector}::vector,
          ${input.collection ?? "policy"},
          ${input.limit ?? DEFAULT_LIMIT}
        )
      `
    )

    const chunks = rows.map((row) =>
      new RetrievedChunk({
        chunk_id: ChunkId.make(row.chunk_id),
        document_id: row.document_id,
        heading: row.heading,
        clause_ref: row.clause_ref,
        content: row.content,
        score: row.score,
        semantic_rank: row.semantic_rank,
        lexical_rank: row.lexical_rank
      })
    )

    // Concluded from the results, never from configuration. A chunk that ranked in a half proves that
    // half ran; nothing else does.
    const semanticRan = chunks.some((chunk) => chunk.semantic_rank !== null)
    const lexicalRan = chunks.some((chunk) => chunk.lexical_rank !== null)
    const mode: RetrievalMode = semanticRan && lexicalRan
      ? "hybrid"
      : semanticRan
      ? "semantic"
      : lexicalRan
      ? "lexical"
      : "none"

    return new Retrieval({ chunks, mode })
  })
