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
 *
 * **Both transports route through AI Gateway, by two different mechanisms** — and this adapter bypassed it
 * on both for longer than the language model did, which is the expensive half of the mistake: the eval
 * harness embeds 99 questions plus the corpus on every run, so the embedder is the call made most often and
 * the one whose cache is worth the most.
 *
 *   binding: a `{ gateway: { id } }` RUN OPTION.  A binding cannot be pointed at a hostname.
 *   REST:    a `cf-aig-gateway-id` HEADER on the same `/ai/run/@cf/{model}` URL.
 *
 * The REST form is deliberately NOT the gateway hostname that `chatCompletionsUrl` builds for the chat
 * endpoint. Cloudflare's own words: *"If you are already calling Workers AI models through the existing
 * REST API, that path (`/ai/run/@cf/{model}`) continues to work. To call Workers AI models through AI
 * Gateway, use the `@cf/` model prefix and include the `cf-aig-gateway-id` header."* So the URL is
 * unchanged and only a header is added — a smaller change than the chat path needed, and one that cannot
 * break the direct call by construction, because omitting the gateway omits a header rather than
 * rewriting a hostname.
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
  /** An AI Gateway id, or undefined to call the account endpoint directly — unmetered and uncached. */
  readonly gateway: string | undefined
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
  /*
   * OPTIONAL, read from the same variable as the chat adapter so one setting moves both.
   *
   * Optional for the reason `workersAiChatConfig` gives: a gateway is an account-level resource somebody
   * has to create, and a harness that refused to run until infrastructure existed would be worse than one
   * that runs unmetered. Cloudflare also accepts the literal id `default`, which creates a gateway on the
   * first authenticated request — so "no gateway exists yet" is not a reason to leave this unset.
   */
  const gateway = yield* Effect.orDie(
    Config.String("CLOUDFLARE_AI_GATEWAY").pipe(Config.withDefault(""))
  )
  return { accountId, token, gateway: gateway === "" ? undefined : gateway }
})

/**
 * The REST headers, with the gateway when one is configured.
 *
 * Exported for tests for the same reason `chatCompletionsUrl` is: this header IS the integration, there is
 * no gateway on the account to verify it against yet, and its failure mode is silent — the call succeeds,
 * unmetered and uncached, and nothing anywhere says so. An assertion is the only thing standing between
 * "routed through the gateway" and "we believe it is".
 *
 * `Redacted.value` is called here rather than in the caller so the token cannot be logged by a debug print
 * of a header object built somewhere else.
 */
export const embedRequestHeaders = (config: {
  readonly token: Redacted.Redacted<string>
  readonly gateway: string | undefined
}): Record<string, string> => ({
  authorization: `Bearer ${Redacted.value(config.token)}`,
  "content-type": "application/json",
  ...(config.gateway === undefined ? {} : { "cf-aig-gateway-id": config.gateway })
})

/**
 * Where the embedding endpoint lives — the SAME url with or without a gateway.
 *
 * Exported alongside the headers so a reader comparing this adapter with the chat one can see that the
 * asymmetry is intended: there, the gateway changes the host; here it does not.
 */
export const embedRunUrl = (config: { readonly accountId: string }): string =>
  `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/run/${WORKERS_AI_EMBEDDING_MODEL}`

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
                fetch(embedRunUrl(config), {
                  method: "POST",
                  headers: embedRequestHeaders(config),
                  body: JSON.stringify({ text: options.inputs })
                }),
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
    input: { readonly text: ReadonlyArray<string> },
    options?: { readonly gateway?: { readonly id: string } } | undefined
  ) => Promise<unknown>
}

export const EmbedderWorkersAiBinding = (
  binding: WorkersAiBinding,
  /**
   * An AI Gateway id. A RUN OPTION rather than a URL, because a binding cannot be pointed at a gateway
   * hostname — see the header docstring for the REST half, which reaches the same gateway by header.
   *
   * Optional, and absent means direct: unmetered, unlogged and uncached. `Main.ts` passes `env.AI_GATEWAY`,
   * which was already being passed to the chat adapter on the very next line while this one went without —
   * a one-line gap that no check could see, because both calls were individually valid.
   */
  gateway?: string
): Layer.Layer<EmbeddingModel.EmbeddingModel | EmbeddingProfile> =>
  Layer.merge(
    Layer.effect(EmbeddingModel.EmbeddingModel)(
      EmbeddingModel.make({
        embedMany: (options: { readonly inputs: ReadonlyArray<string> }) =>
          Effect.gen(function*() {
            const runOptions = gateway === undefined ? undefined : { gateway: { id: gateway } }
            const raw = yield* Effect.tryPromise({
              try: () => binding.run(WORKERS_AI_EMBEDDING_MODEL, { text: options.inputs }, runOptions),
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
