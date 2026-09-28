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
import type { Collection } from "@ea/modules/shared/domain/Corpus"
import { CurrentUser } from "@ea/modules/shared/domain/Identity"
import {
  ChunkId,
  PolicySearch,
  type PolicySearchService,
  Retrieval,
  type RetrievalMode,
  RetrievedChunk
} from "@ea/modules/shared/domain/Retrieval"
import { Db } from "@ea/modules/shared/tables/Database"
import { Effect, Layer } from "effect"
import { EmbeddingModel } from "effect/ai"
import { SqlClient } from "effect/sql"

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

/**
 * The `PolicySearch` implementation.
 *
 * `decision` asks for the port; this is the slice that answers. A database failure becomes a defect
 * rather than part of the port's signature: a caller deciding an invoice can do nothing useful with
 * "the corpus was unreachable" except fail, and the queue's retry is the right response.
 */
export const PolicySearchLive: Layer.Layer<
  PolicySearch,
  never,
  Db | EmbeddingModel.EmbeddingModel | SqlClient.SqlClient | CurrentUser
> = Layer.effect(PolicySearch)(
  Effect.gen(function*() {
    /*
     * Everything is captured at layer build, so `search` has no requirements of its own.
     *
     * That is what a port costs: the caller asked for a capability, so the capability cannot turn
     * round and ask the caller for a connection. The consequence is the same as the workflow engine's
     * — **this layer is built inside the request scope, not in the memoised app layer** — because a
     * socket cannot outlive the request that opened it on Workers.
     */
    const db = yield* Db
    const model = yield* EmbeddingModel.EmbeddingModel
    const sql = yield* SqlClient.SqlClient
    const identity = yield* CurrentUser

    return {
      search: (input) =>
        Effect.orDie(
          RetrievePolicy(input).pipe(
            Effect.provideService(Db, db),
            Effect.provideService(EmbeddingModel.EmbeddingModel, model),
            Effect.provideService(SqlClient.SqlClient, sql),
            Effect.provideService(CurrentUser, identity)
          )
        )
    } satisfies PolicySearchService
  })
)
