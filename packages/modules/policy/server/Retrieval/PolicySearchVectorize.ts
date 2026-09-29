/**
 * `PolicySearch` over Cloudflare Vectorize, via LangChain's `CloudflareVectorizeStore`.
 *
 * This is the managed-store arm of the comparison, and LangChain is doing real work here: document-to-
 * vector mapping, metadata round-tripping and id handling are what the wrapper is for, unlike the
 * embeddings case where it was a pass-through.
 *
 * **It only runs inside a Worker.** `CloudflareVectorizeStore` takes `index: VectorizeIndex` — a binding,
 * with no REST option — exactly like `CloudflareWorkersAIEmbeddings`. So this cannot be measured from the
 * Node eval harness; the comparison for it is a Worker test against a real index.
 *
 * ## Three consequences worth knowing before choosing it
 *
 * 1. **No lexical half.** Vectorize is vector similarity only, so `mode` is always `"semantic"`, never
 *    `"hybrid"`. Rail 4 requires hybrid for auto-approval, so with this adapter **nothing can ever be
 *    auto-approved**. Either keep Postgres FTS as the lexical half (two stores, which is the divergence
 *    problem) or change rail 4 deliberately. It is not a detail to discover at step 9.
 * 2. **No row-level security.** Postgres enforces tenancy with a policy and a forced non-superuser role;
 *    Vectorize has metadata filters. So the org filter below is the ONLY thing separating tenants —
 *    app-layer alone, which is precisely the arrangement that let `Intake.list` leak across orgs earlier
 *    in this project until RLS was actually in force. Treat the filter as load-bearing, not defensive.
 * 3. **Metadata limits.** 10 indexed fields at 64 bytes each, 10 KiB total per vector. Chunk content of
 *    ~1.2 KB fits comfortably, so the citable text can live with the vector — but `content` must stay
 *    UNINDEXED (it exceeds 64 bytes) and therefore cannot be filtered on.
 */
import type { DocumentChunk } from "@ea/modules/policy/domain/Chunk"
import { embeddableText } from "@ea/modules/policy/domain/Chunk"
import type { OrgId } from "@ea/modules/shared/domain/Identity"
import {
  ChunkId,
  PolicySearch,
  type PolicySearchService,
  Retrieval,
  RetrievedChunk
} from "@ea/modules/shared/domain/Retrieval"
import { CloudflareVectorizeStore } from "@langchain/cloudflare"
import { Effect, Layer } from "effect"
import { EmbeddingModel } from "effect/ai"

/**
 * The slice of the Vectorize binding used here. Structural, to keep `@cloudflare/workers-types` out of
 * the modules package — the same reasoning as `DocumentBucketApi` and `WorkersAiBinding`.
 */
export interface VectorizeIndexApi {
  readonly insert: (vectors: ReadonlyArray<unknown>) => Promise<unknown>
  readonly upsert: (vectors: ReadonlyArray<unknown>) => Promise<unknown>
  readonly query: (vector: ReadonlyArray<number>, options?: unknown) => Promise<unknown>
  readonly deleteByIds: (ids: ReadonlyArray<string>) => Promise<unknown>
}

/**
 * Bridges our `EmbeddingModel` port into LangChain's `Embeddings` interface.
 *
 * The point of the bridge rather than using `CloudflareWorkersAIEmbeddings`: the Vectorize arm then
 * differs from the pgvector arm **only in the store**. Two things changing at once would make the
 * comparison say nothing about either.
 */
const asLangChainEmbeddings = (model: EmbeddingModel.EmbeddingModel) => ({
  embedDocuments: (texts: Array<string>) =>
    Effect.runPromise(
      Effect.map(model.embedMany(texts), (response) => response.embeddings.map((entry) => [...entry.vector]))
    ),
  embedQuery: (text: string) => Effect.runPromise(Effect.map(model.embed(text), (response) => [...response.vector]))
})

/** Writes a document's chunks into Vectorize. The index path, which `PolicySearch` does not cover. */
export const indexIntoVectorize = (options: {
  readonly index: VectorizeIndexApi
  readonly orgId: OrgId
  readonly documentId: string
  readonly chunks: ReadonlyArray<DocumentChunk>
}) =>
  Effect.flatMap(EmbeddingModel.EmbeddingModel, (model) =>
    Effect.promise(async () => {
      const store = new CloudflareVectorizeStore(
        asLangChainEmbeddings(model),
        // The cast is the price of the structural binding type above; the shapes agree at runtime.
        { index: options.index as never }
      )
      await store.addDocuments(
        options.chunks.map((chunk) => ({
          pageContent: embeddableText(chunk),
          metadata: {
            // The org filter is the ONLY tenancy boundary here — see the module docstring, point 2.
            organization_id: options.orgId,
            document_id: options.documentId,
            clause_ref: chunk.clauseRef ?? "",
            // Unindexed: over 64 bytes, so it round-trips but cannot be filtered on.
            content: chunk.content
          }
        })),
        { ids: options.chunks.map((chunk) => `${options.documentId}:${chunk.ordinal}`) }
      )
    }))

export const policySearchVectorize = (
  index: VectorizeIndexApi,
  orgId: OrgId
): Layer.Layer<PolicySearch, never, EmbeddingModel.EmbeddingModel> =>
  Layer.effect(PolicySearch)(
    Effect.map(EmbeddingModel.EmbeddingModel, (model) => ({
      search: (input) =>
        Effect.orDie(
          Effect.promise(async () => {
            const store = new CloudflareVectorizeStore(
              asLangChainEmbeddings(model),
              { index: index as never }
            )
            const hits = await store.similaritySearchWithScore(
              input.query,
              input.limit ?? 8,
              // App-layer tenancy. There is no RLS behind this.
              { organization_id: options(orgId) }
            )

            return new Retrieval({
              chunks: hits.map(([document, score], rank) =>
                new RetrievedChunk({
                  chunk_id: ChunkId.make(String(document.metadata["chunk_id"] ?? document.id ?? rank)),
                  document_id: String(document.metadata["document_id"] ?? ""),
                  heading: null,
                  clause_ref: (document.metadata["clause_ref"] as string) || null,
                  content: String(document.metadata["content"] ?? document.pageContent),
                  score,
                  semantic_rank: rank + 1,
                  // Always null: Vectorize has no lexical half. Hence mode "semantic", never "hybrid".
                  lexical_rank: null
                })
              ),
              mode: "semantic"
            })
          })
        )
    } satisfies PolicySearchService))
  )

/** Vectorize metadata filters compare with an operator object; equality is `{ $eq }`. */
const options = (orgId: OrgId) => ({ $eq: orgId })
