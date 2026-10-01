/**
 * The real embedder: any OpenAI-shaped `/v1/embeddings` endpoint.
 *
 * One adapter covers both provider profiles because Mistral's API is OpenAI-compatible, which is what
 * makes the residency decision a base-URL change rather than a second integration:
 *
 *   `mistral-eu`  → https://api.mistral.ai/v1  · `mistral-embed`   · EU jurisdiction, DPA available
 *   `openrouter`  → https://openrouter.ai/api/v1 · `baai/bge-m3`   · model-agnostic, one key
 *
 * **The residency nuance that makes these two profiles rather than one:** routing Mistral *through*
 * OpenRouter means the request transits a US intermediary, which defeats the entire argument. An EU
 * client needs the direct base URL, and that is a configuration fact worth recording per client
 * (docs/runbooks/ProviderProfiles.md) rather than a default.
 *
 * **Stateless endpoint only.** Mistral's Zero Data Retention covers stateless calls — embeddings among
 * them — and explicitly does not cover stateful products. `/embeddings` is stateless, and this adapter
 * must not grow a call that is not. That is asserted by the shape of the file: one request, no session,
 * no conversation id.
 */
import { EMBEDDING_DIMENSIONS } from "@ea/modules/policy/domain/Chunk"
import { EmbeddingProfile } from "@ea/modules/policy/domain/Embedding"
import { Config, Effect, Layer, Redacted, Schema } from "effect"
import { EmbeddingModel } from "effect/ai"
import { AiError } from "effect/ai"
import { HttpBody, HttpClient, HttpClientRequest } from "effect/http"

/** Only the fields we use. A provider adding fields must not break the decode. */
const EmbeddingsResponse = Schema.Struct({
  data: Schema.Array(Schema.Struct({ embedding: Schema.Array(Schema.Finite) })),
  usage: Schema.optional(Schema.Struct({ prompt_tokens: Schema.optional(Schema.Finite) }))
})

export interface EmbedderConfig {
  readonly baseUrl: string
  readonly apiKey: Redacted.Redacted<string>
  readonly modelId: string
}

/**
 * Reads the profile from configuration.
 *
 * `EMBEDDING_BASE_URL` defaults to Mistral's, not OpenRouter's: the EU-resident path should be what
 * you get by forgetting to choose, because the failure mode of the other default is a compliance
 * problem that nothing in the system would report.
 */
export const embedderConfig: Effect.Effect<EmbedderConfig> = Effect.gen(function*() {
  const baseUrl = yield* Config.String("EMBEDDING_BASE_URL").pipe(Config.withDefault("https://api.mistral.ai/v1"))
  const modelId = yield* Config.String("EMBEDDING_MODEL").pipe(Config.withDefault("mistral-embed"))
  const apiKey = yield* Config.Redacted("EMBEDDING_API_KEY")
  return { baseUrl, apiKey, modelId }
}).pipe(Effect.orDie)

export const EmbedderOpenAiCompatible: Layer.Layer<
  EmbeddingModel.EmbeddingModel | EmbeddingProfile,
  never,
  HttpClient.HttpClient
> = Layer.unwrap(
  Effect.map(embedderConfig, (config) =>
    Layer.merge(
      Layer.effect(EmbeddingModel.EmbeddingModel)(
        Effect.flatMap(HttpClient.HttpClient, (client) =>
          EmbeddingModel.make({
            embedMany: (options: { readonly inputs: ReadonlyArray<string> }) =>
              Effect.gen(function*() {
                const response = yield* client.execute(
                  HttpClientRequest.post(`${config.baseUrl}/embeddings`, {
                    headers: { authorization: `Bearer ${Redacted.value(config.apiKey)}` },
                    body: yield* HttpBody.json({ model: config.modelId, input: options.inputs })
                  })
                )
                const decoded = yield* Schema.decodeUnknownEffect(EmbeddingsResponse)(
                  yield* response.json
                )
                return {
                  results: decoded.data.map((entry) => [...entry.embedding]),
                  usage: { inputTokens: decoded.usage?.prompt_tokens }
                }
              }).pipe(
                // Every failure becomes an AiError: a provider being unreachable is not something a
                // caller distinguishes from a malformed response, and both mean "do not index".
                Effect.mapError((cause) =>
                  AiError.make({
                    module: "EmbedderOpenAiCompatible",
                    method: "embedMany",
                    reason: new AiError.UnknownError({
                      description: cause instanceof Error ? cause.message : String(cause)
                    })
                  })
                )
              )
          }))
      ),
      Layer.succeed(EmbeddingProfile)({
        modelId: config.modelId,
        dimensions: EMBEDDING_DIMENSIONS,
        semantic: true
      })
    ))
)
