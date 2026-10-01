/**
 * A `LanguageModel` over any OpenAI-compatible endpoint, via `@effect/ai-openai`.
 *
 * **This exists because tool calling should not be hand-rolled.** The sibling adapter
 * (`decision/server/Extraction/LanguageModelWorkersAi.ts`) is hand-written and correct for what it does —
 * structured output over the Workers AI binding, where the binding *is* the authorisation and no token or
 * egress is involved. It deliberately has no tool support: it ignores `options.tools` and refuses tool
 * messages rather than dropping them silently.
 *
 * An agent needs tools, and adding them by hand means owning the whole OpenAI tool protocol: serialising
 * parameter schemas, replaying assistant `tool_calls` so a result has a call to answer, threading
 * `tool_call_id` through every result, and `tool_choice`. Getting the id wrong does not error — the model
 * simply cannot tell which call a result belongs to and starts answering from the wrong evidence. That is a
 * maintained upstream implementation's job, and `OpenAiLanguageModel` already has it: `prepareTools`,
 * `tool_choice`, and `tool-call`/`tool-result` part mapping including provider-executed tools.
 *
 * It was started by hand and abandoned deliberately, three type errors in, once that was checked.
 *
 * ## The division of labour, which is not arbitrary
 *
 * | Path | Adapter | Why |
 * | --- | --- | --- |
 * | decide pipeline | Workers AI **binding** | structured output only, never tools. No token, no egress, and the binding is the authorisation |
 * | agent / Q&A | this, over HTTP | needs tools, and wants a maintained protocol implementation |
 * | eval harness | this, over HTTP | runs in Node and cannot hold a binding |
 *
 * ## Pointing it at Workers AI
 *
 * `apiUrl` is what makes this work against something other than OpenAI, and it is the route `PLAN.md` names
 * for Mistral too. Verified at rc.118 rather than assumed: `OpenAiClient.make` takes `apiUrl` and defaults it
 * to `https://api.openai.com/v1`, and `layerConfig` takes it as a `Config`.
 *
 * Prefer the **AI Gateway** URL when a gateway exists: it adds response caching, retries, spend limits and
 * per-request cost logging, and it is the one place a non-Cloudflare provider comes back under Cloudflare
 * control. Without it this is a direct, unmetered, uncached call — a real state, so the caller is expected to
 * say which it got rather than leave it implicit.
 */
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai"
import { Config, Effect, Layer, type Redacted } from "effect"
import type { LanguageModel } from "effect/ai"
import { FetchHttpClient } from "effect/http"

export interface OpenAiCompatibleConfig {
  /** No trailing slash and no `/chat/completions`: the client appends the path. */
  readonly apiUrl: string
  readonly apiKey: Redacted.Redacted<string>
  readonly model: string
}

/**
 * Workers AI's OpenAI-compatible base URL, with or without a gateway.
 *
 * The gateway form uses the **provider-specific** path rather than the unified `/compat/` one: it keeps the
 * model id exactly as Workers AI names it, where `/compat/` requires a `workers-ai/` prefix on every model.
 * One fewer place a model id is rewritten is worth more than provider-agnosticism nothing is using yet — and
 * a second provider gets its own path on the same gateway, which is the point of a gateway.
 */
export const workersAiApiUrl = (options: {
  readonly accountId: string
  readonly gateway: string | undefined
}): string =>
  options.gateway === undefined
    ? `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/ai/v1`
    : `https://gateway.ai.cloudflare.com/v1/${options.accountId}/${options.gateway}/workers-ai/v1`

/** Reads Workers AI credentials and builds the base URL. Never defaulted: a missing token must fail. */
export const workersAiOpenAiConfig: Effect.Effect<OpenAiCompatibleConfig> = Effect.gen(function*() {
  const accountId = yield* Config.String("CLOUDFLARE_ACCOUNT_ID")
  const apiKey = yield* Config.Redacted("CLOUDFLARE_AI_TOKEN")
  const gateway = yield* Config.String("CLOUDFLARE_AI_GATEWAY").pipe(Config.withDefault(""))
  const model = yield* Config.String("AGENT_MODEL").pipe(Config.withDefault("@cf/meta/llama-3.3-70b-instruct-fp8-fast"))
  return {
    apiUrl: workersAiApiUrl({ accountId, gateway: gateway === "" ? undefined : gateway }),
    apiKey,
    model
  }
}).pipe(Effect.orDie)

/**
 * The layer. `FetchHttpClient` because a Worker has `fetch` and nothing else — no Node http, no undici.
 */
export const languageModelOpenAiCompatible = (
  config: OpenAiCompatibleConfig
): Layer.Layer<LanguageModel.LanguageModel> =>
  OpenAiLanguageModel.layer({ model: config.model }).pipe(
    Layer.provide(
      OpenAiClient.layer({
        apiUrl: config.apiUrl,
        apiKey: config.apiKey
      })
    ),
    Layer.provide(FetchHttpClient.layer)
  )

/** Workers AI, read from configuration. The form the eval harness and the agent surface both use. */
export const LanguageModelWorkersAiOpenAi: Layer.Layer<LanguageModel.LanguageModel> = Layer.unwrap(
  Effect.map(workersAiOpenAiConfig, languageModelOpenAiCompatible)
)
