/**
 * Workers AI embeddings, over both transports.
 *
 * `@cf/baai/bge-m3` at 1024 dimensions, which is exactly `EMBEDDING_DIMENSIONS` — so this model can be
 * swapped in without a schema migration, unlike most alternatives.
 *
 * **Why this is not `CloudflareWorkersAIEmbeddings` from `@langchain/cloudflare`.** That wrapper is the
 * same service and the same model; it adds batching and a `stripNewLines` flag over the binding. But it
 * takes `binding: Ai` with no REST option, so it cannot run outside a Worker — which would leave the
 * recall gate unable to measure the semantic half, and measuring that is the entire reason this adapter
 * exists. Where LangChain does real work (the Vectorize store, loaders, splitters) it is used; here it
 * would be an adapter around an adapter that also broke the harness.
 *
 * Two transports behind one layer:
 *
 *   `env.AI.run(model, { text })`  in the Worker. No token, no egress, billed as Workers AI.
 *   REST with a bearer token       in Node: the eval harness, and anything running outside workerd.
 *
 * Same model and therefore the same vectors either way, which is what makes a number measured in the
 * harness meaningful for production.
 */
import { EMBEDDING_DIMENSIONS } from "@ea/modules/policy/domain/Chunk"
import { EmbeddingProfile } from "@ea/modules/policy/domain/Embedding"
import { Config, Effect, Layer, Redacted, Schema } from "effect"
import { AiError, EmbeddingModel } from "effect/ai"

/** `@cf/bge-*` models return `{ shape: [rows, dims], data: number[][] }`. */
const WorkersAiEmbedding = Schema.Struct({
  shape: Schema.optional(Schema.Array(Schema.Finite)),
  data: Schema.Array(Schema.Array(Schema.Finite))
})

/** The REST envelope wraps that in `result`, with `success` and `errors` beside it. */
const RestEnvelope = Schema.Struct({
  success: Schema.Boolean,
  errors: Schema.optional(Schema.Array(Schema.Unknown)),
  result: WorkersAiEmbedding
})

export const WORKERS_AI_EMBEDDING_MODEL = "@cf/baai/bge-m3"

const fail = (description: string) =>
  AiError.make({
    module: "EmbedderWorkersAi",
    method: "embedMany",
    reason: new AiError.UnknownError({ description })
  })

/** Rejects a response whose width disagrees with the column, before any of it is stored. */
const checkWidth = (vectors: ReadonlyArray<ReadonlyArray<number>>) =>
  vectors.length > 0 && vectors[0]!.length !== EMBEDDING_DIMENSIONS
    ? Effect.fail(
      fail(
        `${WORKERS_AI_EMBEDDING_MODEL} returned ${vectors[0]!.length} dimensions, but the column is ` +
          `${EMBEDDING_DIMENSIONS}. Changing the model is a data migration — see docs/runbooks/ReEmbed.md.`
      )
    )
    : Effect.succeed(vectors.map((vector) => [...vector]))

const profile = Layer.succeed(EmbeddingProfile)({
  modelId: WORKERS_AI_EMBEDDING_MODEL,
  dimensions: EMBEDDING_DIMENSIONS,
  // Real vectors, so the recall harness will report the hybrid column rather than suppressing it.
  semantic: true
})

// -----------------------------------------------------------------------------
// REST — for the eval harness and anything outside workerd
// -----------------------------------------------------------------------------

export interface WorkersAiRestConfig {
  readonly accountId: string
  readonly token: Redacted.Redacted<string>
}

/**
 * Reads the REST credentials.
 *
 * Deliberately NOT defaulted: an absent token must be an explicit failure rather than a silent fall
 * back to the deterministic embedder, because that would report a lexical number as a semantic one.
 */
export const workersAiRestConfig: Effect.Effect<WorkersAiRestConfig> = Effect.gen(function*() {
  const accountId = yield* Effect.orDie(Config.String("CLOUDFLARE_ACCOUNT_ID"))
  const token = yield* Effect.orDie(Config.Redacted("CLOUDFLARE_AI_TOKEN"))
  return { accountId, token }
})

export const EmbedderWorkersAiRest: Layer.Layer<
  EmbeddingModel.EmbeddingModel | EmbeddingProfile
> = Layer.merge(
  Layer.effect(EmbeddingModel.EmbeddingModel)(
    Effect.flatMap(workersAiRestConfig, (config) =>
      EmbeddingModel.make({
        embedMany: (options: { readonly inputs: ReadonlyArray<string> }) =>
          Effect.gen(function*() {
            const response = yield* Effect.tryPromise({
              try: () =>
                fetch(
                  `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/run/${WORKERS_AI_EMBEDDING_MODEL}`,
                  {
                    method: "POST",
                    headers: {
                      authorization: `Bearer ${Redacted.value(config.token)}`,
                      "content-type": "application/json"
                    },
                    body: JSON.stringify({ text: options.inputs })
                  }
                ),
              catch: (cause) => fail(`Workers AI request failed: ${String(cause)}`)
            })

            const body = yield* Effect.tryPromise({
              try: () => response.json() as Promise<unknown>,
              catch: () => fail(`Workers AI returned a non-JSON body with status ${response.status}`)
            })

            const decoded = yield* Effect.mapError(
              Schema.decodeUnknownEffect(RestEnvelope)(body),
              // A decode failure here means the response shape changed. Say so with the status, rather
              // than surfacing a schema path that reads like a bug in this file.
              (error) =>
                fail(
                  `Workers AI response did not match the expected shape (status ${response.status}): ${error.message}`
                )
            )
            if (!decoded.success) {
              return yield* Effect.fail(fail(`Workers AI reported failure: ${JSON.stringify(decoded.errors)}`))
            }

            return {
              results: yield* checkWidth(decoded.result.data),
              // The REST envelope does not report token usage for embeddings.
              usage: { inputTokens: undefined }
            }
          })
      }))
  ),
  profile
)

// -----------------------------------------------------------------------------
// Binding — for the deployed Worker
// -----------------------------------------------------------------------------

/**
 * The slice of the `AI` binding this adapter uses.
 *
 * Structural rather than importing `Ai` from `@cloudflare/workers-types`, for the same reason as
 * `DocumentBucketApi`: it keeps a Cloudflare dependency out of the modules package, and avoids tying a
 * second copy of those ambient declarations into the program alongside the Worker's own.
 */
export interface WorkersAiBinding {
  readonly run: (
    model: string,
    input: { readonly text: ReadonlyArray<string> }
  ) => Promise<unknown>
}

export const EmbedderWorkersAiBinding = (
  binding: WorkersAiBinding
): Layer.Layer<EmbeddingModel.EmbeddingModel | EmbeddingProfile> =>
  Layer.merge(
    Layer.effect(EmbeddingModel.EmbeddingModel)(
      EmbeddingModel.make({
        embedMany: (options: { readonly inputs: ReadonlyArray<string> }) =>
          Effect.gen(function*() {
            const raw = yield* Effect.tryPromise({
              try: () => binding.run(WORKERS_AI_EMBEDDING_MODEL, { text: options.inputs }),
              catch: (cause) => fail(`env.AI.run failed: ${String(cause)}`)
            })
            // The binding returns the payload unwrapped, without the REST envelope.
            const decoded = yield* Effect.mapError(
              Schema.decodeUnknownEffect(WorkersAiEmbedding)(raw),
              (error) => fail(`env.AI.run returned an unexpected shape: ${error.message}`)
            )
            return {
              results: yield* checkWidth(decoded.data),
              usage: { inputTokens: undefined }
            }
          })
      })
    ),
    profile
  )
