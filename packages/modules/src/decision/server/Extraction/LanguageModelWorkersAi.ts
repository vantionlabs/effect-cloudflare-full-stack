/**
 * Workers AI as a `LanguageModel`, over both transports.
 *
 * The same shape as `EmbedderWorkersAi` and for the same reason: the eval harness runs in Node and cannot
 * hold a binding, the Worker holds a binding and should not carry a token. One adapter, two transports,
 * the same model either way — which is what makes a number measured in the harness mean anything for
 * production.
 *
 * ## AI Gateway
 *
 * Both transports can route through an AI Gateway, by different means: REST changes the URL, the binding
 * takes a `gateway` run option. Optional in both cases — absent means a direct, unmetered, uncached call,
 * and the eval harness prints which it got so the two cannot be confused.
 *
 * Worth it for a measured reason: a 99-case eval run failed on all 99 with the free tier's daily neuron
 * allocation, spent by repeated runs of identical fixtures at temperature 0. A response cache serves those
 * for nothing. See docs/services.md §7.
 *
 * ## Why hand-rolled rather than `@effect/ai-openai`
 *
 * `OpenAiClient` with `apiUrl` is the route the plan names, and it would work: Cloudflare exposes an
 * OpenAI-compatible `/ai/v1/chat/completions`. It is not used here because it brings an `HttpClient`
 * requirement into the layer for a surface this adapter uses about forty lines of, and because the
 * binding transport has no OpenAI-compatible form at all — so that half would be hand-rolled regardless
 * and the two halves would then disagree about error mapping. The provider protocol `generateText` has to
 * satisfy is small and stable, and the tests pin it.
 *
 * ## The protocol this has to get right
 *
 * `LanguageModel.generateObject` does NOT put the schema in the prompt. It sets
 * `responseFormat: { type: "json", objectName, schema }` with `toolChoice: "none"` and then decodes the
 * concatenated **text** parts. So structured output works only if this adapter forwards a real JSON
 * schema to the provider. Forget that and the model returns prose, decoding fails, and the failure looks
 * like a bad model rather than a missing field on a request.
 *
 * `Schema.toJsonSchemaDocument` emits `{ schema, definitions }` where `schema` is a `$ref` into
 * `#/$defs/…`. The reference prefix is `$defs` and the emitted key is `definitions`, so they have to be
 * reconciled or every nested type resolves to nothing — `Citation` inside `ProposedDecision` is exactly
 * that case.
 */
import { Config, Effect, Layer, Redacted, Schedule, Schema } from "effect"
import { AiError, LanguageModel, type Prompt, type Response } from "effect/ai"

/**
 * The default model.
 *
 * Chosen for two properties rather than for a benchmark: it honours `response_format: json_schema` on the
 * OpenAI-compatible endpoint (verified by request, not by documentation), and it is fast enough that a
 * 99-case eval run finishes in minutes. `EVAL_MODEL` overrides it, because comparing models is the point
 * of having a harness.
 */
export const WORKERS_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"

/**
 * `max_tokens`, which must be set explicitly.
 *
 * Workers AI defaults it low — low enough that a full invoice extraction is cut off mid-string, and every
 * single call failed with `finish_reason: "length"` the first time this adapter ran a real eval. The failure
 * is loud because `toParts` checks for it; without that check the truncated JSON would have failed to
 * decode, been classified as an invalid output, and RETRIED — truncating at exactly the same place and
 * burning a second call to learn nothing.
 *
 * 4096 covers an invoice with a dozen line items and their spans, with room to spare. It is the input that
 * a provider default should never have been trusted for.
 */
const MAX_TOKENS = 4096

/**
 * `temperature: 0`, and this is not a tuning preference.
 *
 * Two independent reasons, either one sufficient. **A decision that authorises a payment must not be
 * sampled**: there is no defensible answer to "why did this invoice get approved and that identical one
 * not", and the product's claim is auditability. And **a harness whose score moves between identical runs
 * cannot detect a regression**: two consecutive 11-case runs of the same fixtures scored 0/10 and 8/11 on
 * uncited decisions before this was set, which is a bigger swing than most changes worth measuring.
 *
 * It does **not** make the pipeline deterministic, and that was measured rather than assumed: two
 * consecutive 12-case runs at temperature 0 scored 6/12 and 5/12 grounded. Provider-side batching and
 * non-deterministic kernels still move things. What changed is the magnitude — an 8-point swing became a
 * 1-point one — so this removes the variance that was ours to remove and no more. Any threshold in the
 * gate has to be set with the residual in mind.
 */
const TEMPERATURE = 0

/** The OpenAI-shaped response. Narrow: only what is read, so an unrelated field changing is not a break. */
const ChatCompletion = Schema.Struct({
  choices: Schema.Array(Schema.Struct({
    finish_reason: Schema.optional(Schema.NullOr(Schema.String)),
    message: Schema.Struct({
      content: Schema.NullOr(Schema.String)
    })
  })),
  usage: Schema.optional(Schema.Struct({
    prompt_tokens: Schema.optional(Schema.Finite),
    completion_tokens: Schema.optional(Schema.Finite),
    total_tokens: Schema.optional(Schema.Finite)
  }))
})

/**
 * A 5xx or a 429 from the provider, which is worth retrying — unlike everything else.
 *
 * Its own type rather than a flag on `AiError`, so the retry schedule below can match on it and nothing
 * else. A 400 means the request is wrong and retrying it is free money for the provider; a 500 means the
 * model host had a bad moment. Measured: 2 of 12 cases on the first real run failed with
 * `{"code":5030,"message":"Internal Error"}`, and both succeeded immediately on a manual re-run.
 */
class RetryableStatus {
  readonly _tag = "RetryableStatus"
  readonly status: number
  readonly body: string
  constructor(options: { readonly status: number; readonly body: string }) {
    this.status = options.status
    this.body = options.body
  }
}

/**
 * Whether a failure is worth retrying, which is NOT the same as whether it is a 429.
 *
 * Workers AI returns 429 for two entirely different things: a rate limit, which clears in seconds, and an
 * **exhausted daily allocation**, which does not clear until tomorrow. Retrying the second one three times
 * per call, across 99 cases, is 297 pointless requests and an error message nobody can act on. Told apart by
 * the body, because the status does not distinguish them.
 *
 * Measured the hard way: a full 99-case run produced 99 identical failures reading
 * `code: 4006, "you have used up your daily free allocation of 10,000 neurons"`.
 *
 * **This stays even once AI Gateway is in use**, although the gateway has `retryMaxAttempts` of its own.
 * The gateway retries transport failures; it cannot make a quota grant appear, so telling the two kinds of
 * 429 apart is still ours to do — and doing it here means the error a caller sees says which one it was.
 */
const QUOTA = /daily free allocation|you have used up|exceeded your quota|code":\s*4006/i

const transient = (status: number, body: string) => !QUOTA.test(body) && (status === 429 || status >= 500)

/** A quota failure, phrased so the reader knows the only two things that resolve it. */
const quotaMessage = (body: string) =>
  "Workers AI daily allocation exhausted (the free tier is 10,000 neurons/day). Wait for the daily reset, " +
  `or move to the Workers Paid plan, or point EVAL_MODEL at another provider. Provider said: ${body}`

const fail = (description: string, method = "generateText") =>
  AiError.make({
    module: "LanguageModelWorkersAi",
    method,
    reason: new AiError.UnknownError({ description })
  })

/**
 * Flattens the prompt into OpenAI chat messages.
 *
 * Only text parts survive, and a non-text part is a **failure rather than a silent drop**. Dropping a file
 * part would send the model a prompt missing the document it was supposed to read, and the result would be
 * a confidently wrong answer about nothing — the single worst failure mode available here. When OCR lands
 * and images start arriving, this throws and the adapter gets extended, which is the correct order.
 */
const toMessages = (
  prompt: Prompt.Prompt
): Effect.Effect<ReadonlyArray<{ role: string; content: string }>, AiError.AiError> =>
  Effect.forEach(prompt.content, (message) => {
    // A tool message has no textual content to forward, and this adapter never offers tools.
    if (message.role === "tool") {
      return Effect.fail(fail("tool messages are not supported: this adapter never offers tools"))
    }
    const parts = message.content
    if (typeof parts === "string") return Effect.succeed({ role: message.role, content: parts })

    const texts: Array<string> = []
    for (const part of parts) {
      if (part.type === "text") texts.push(part.text)
      else if (part.type !== "reasoning") {
        return Effect.fail(
          fail(
            `prompt part "${part.type}" cannot be sent to Workers AI by this adapter, and dropping it ` +
              "would send the model a prompt missing the thing it was asked to read"
          )
        )
      }
    }
    return Effect.succeed({ role: message.role, content: texts.join("\n\n") })
  })

/**
 * The provider-side JSON schema for a response format, self-contained.
 *
 * `$defs` rather than `definitions`: `toJsonSchemaDocument` emits the latter while its own `$ref`s point at
 * the former, and a provider resolving `#/$defs/CitationEncoded` against a document that only has
 * `definitions` silently sees an empty schema for every nested type.
 */
const jsonSchemaFor = (schema: Schema.Top): Record<string, unknown> => {
  const document = Schema.toJsonSchemaDocument(schema as never)
  return {
    ...document.schema as Record<string, unknown>,
    $defs: document.definitions
  }
}

/** Builds the request body shared by both transports. */
const bodyFor = (
  options: LanguageModel.ProviderOptions,
  messages: ReadonlyArray<{ role: string; content: string }>,
  model: string
): Record<string, unknown> => ({
  model,
  messages,
  max_tokens: MAX_TOKENS,
  temperature: TEMPERATURE,
  ...options.responseFormat.type === "json"
    ? {
      response_format: {
        type: "json_schema",
        json_schema: {
          name: options.responseFormat.objectName,
          schema: jsonSchemaFor(options.responseFormat.schema)
        }
      }
    }
    : {}
})

/** Turns the decoded completion into the text parts `generateObject` and `generateText` both expect. */
const toParts = (
  completion: typeof ChatCompletion.Type,
  /**
   * The model this adapter CALLED, reported as `response-metadata`. Usage metering labels token counts by it,
   * and a token count without a model is not a cost: a 70B call and a small one differ by an order of magnitude.
   * The adapter is the only place that knows it — the response body does not echo it back.
   */
  modelId: string
): Effect.Effect<Array<Response.PartEncoded>, AiError.AiError> => {
  const choice = completion.choices[0]
  if (choice === undefined) return Effect.fail(fail("Workers AI returned no choices"))
  /*
   * A truncated response is a failure, not a short answer.
   *
   * `finish_reason: "length"` on a JSON response means the object is cut off mid-string. Decoding would
   * fail anyway, but it would fail as "invalid output" and be RETRIED — and the retry would truncate at
   * exactly the same place, burning a second call to learn nothing. Naming it here makes it legible.
   */
  if (choice.finish_reason === "length") {
    return Effect.fail(
      fail(
        `Workers AI truncated the response (finish_reason: length) at max_tokens=${MAX_TOKENS}. Raise ` +
          "MAX_TOKENS in this adapter, or shorten the prompt — retrying will truncate identically."
      )
    )
  }
  if (choice.message.content === null || choice.message.content === "") {
    return Effect.fail(fail("Workers AI returned an empty message"))
  }
  const parts: Array<Response.PartEncoded> = [
    { type: "response-metadata", modelId },
    { type: "text", text: choice.message.content }
  ]
  if (completion.usage !== undefined) {
    parts.push({
      type: "finish",
      reason: "stop",
      /*
       * `inputTokens` and `outputTokens` are objects here, not numbers: v4 splits input into
       * uncached/cacheRead/cacheWrite and output into text/reasoning. Workers AI reports neither
       * breakdown, so only `total` is filled — reporting a breakdown it did not send would make a cost
       * report look precise when it is a guess. There is no `totalTokens` field; the two totals add up.
       */
      usage: {
        inputTokens: { total: completion.usage.prompt_tokens },
        outputTokens: { total: completion.usage.completion_tokens }
      }
    })
  }
  return Effect.succeed(parts)
}

const decode = (raw: unknown, status: number) =>
  Effect.mapError(
    Schema.decodeUnknownEffect(ChatCompletion)(raw),
    (error) => fail(`Workers AI response did not match the OpenAI chat shape (status ${status}): ${error.message}`)
  )

// -----------------------------------------------------------------------------
// REST — the eval harness and anything outside workerd
// -----------------------------------------------------------------------------

export interface WorkersAiChatConfig {
  readonly accountId: string
  readonly token: Redacted.Redacted<string>
  readonly model: string
  /** An AI Gateway id, or undefined to call the account endpoint directly. */
  readonly gateway: string | undefined
}

/** Reads the credentials. Never defaulted: a missing token must fail, not fall back to a stub. */
export const workersAiChatConfig: Effect.Effect<WorkersAiChatConfig> = Effect.gen(function*() {
  const accountId = yield* Config.String("CLOUDFLARE_ACCOUNT_ID")
  const token = yield* Config.Redacted("CLOUDFLARE_AI_TOKEN")
  const model = yield* Config.String("EVAL_MODEL").pipe(Config.withDefault(WORKERS_AI_MODEL))
  /*
   * OPTIONAL, and absent means "call the account endpoint directly".
   *
   * Optional rather than required because a gateway is an account-level resource somebody has to create,
   * and this adapter must keep working without one — a harness that refused to run until infrastructure
   * existed would be worse than one that runs unmetered. Whether a gateway is in use is printed by the
   * eval harness, so an unmetered run cannot be mistaken for a metered one.
   */
  const gateway = yield* Config.String("CLOUDFLARE_AI_GATEWAY").pipe(Config.withDefault(""))
  return { accountId, token, model, gateway: gateway === "" ? undefined : gateway }
}).pipe(Effect.orDie)

/**
 * Where the OpenAI-compatible chat endpoint lives, with or without a gateway.
 *
 * The gateway form is the **provider-specific** path (`…/{gateway}/workers-ai/v1/chat/completions`) rather
 * than the unified `/compat/` one. Both work; this one keeps the model id exactly as Workers AI names it,
 * where `/compat/` requires a `workers-ai/` prefix on every model. Fewer places for a model id to be
 * rewritten is worth more here than provider-agnosticism we are not using yet — and when a second
 * provider arrives it gets its own path on the same gateway, which is the point of the gateway.
 *
 * Exported for tests: this URL is the whole integration, so it is verified by assertion as well.
 *
 * **This comment used to say "no gateway exists on the account yet", and that became false without anyone
 * noticing** — `effect-ai-ai-dev` was created 2026-09-29 and the gateway's own logs show this adapter's
 * calls from 14:42 UTC the next day. The stale claim was then read and repeated as a finding, which is
 * exactly what `AGENTS.md` warns about: an external fact belongs in `docs/references.md` with the date it
 * was checked, so a stale claim can be told from a wrong one. An inline one has nothing to date it against.
 * The fact now has a row there.
 */
export const chatCompletionsUrl = (config: {
  readonly accountId: string
  readonly gateway: string | undefined
}): string =>
  config.gateway === undefined
    ? `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/v1/chat/completions`
    : `https://gateway.ai.cloudflare.com/v1/${config.accountId}/${config.gateway}/workers-ai/v1/chat/completions`

export const LanguageModelWorkersAiRest: Layer.Layer<LanguageModel.LanguageModel> = Layer.effect(
  LanguageModel.LanguageModel
)(
  Effect.flatMap(workersAiChatConfig, (config) =>
    LanguageModel.make({
      generateText: (options) =>
        Effect.gen(function*() {
          const messages = yield* toMessages(options.prompt)
          const response = yield* Effect.tryPromise({
            try: () =>
              fetch(
                chatCompletionsUrl(config),
                {
                  method: "POST",
                  headers: {
                    authorization: `Bearer ${Redacted.value(config.token)}`,
                    "content-type": "application/json"
                  },
                  body: JSON.stringify(bodyFor(options, messages, config.model))
                }
              ),
            catch: (cause) => fail(`Workers AI request failed: ${String(cause)}`)
          })

          const raw = yield* Effect.tryPromise({
            try: () => response.json() as Promise<unknown>,
            catch: () => fail(`Workers AI returned a non-JSON body with status ${response.status}`)
          })

          if (!response.ok) {
            // The error body, not just the status: Workers AI reports model-not-found and quota
            // separately and they need different responses from a human.
            const body = JSON.stringify(raw).slice(0, 400)
            return yield* Effect.fail(
              transient(response.status, body)
                ? new RetryableStatus({ status: response.status, body })
                : QUOTA.test(body)
                ? fail(quotaMessage(body))
                : fail(`Workers AI returned ${response.status}: ${body}`)
            )
          }

          return yield* toParts(yield* decode(raw, response.status), config.model)
        }).pipe(
          /*
           * Three attempts, exponential from 500ms, and ONLY for a transient status.
           *
           * `LanguageModel.generateObject` has its own retry for invalid output, and it is the wrong layer
           * for this: a 500 never reaches it, because the request failed before any output existed. Note
           * what is deliberately NOT retried — a decode failure, which fails identically every time, and a
           * truncated response, which truncates at the same place.
           */
          Effect.retry({
            times: 3,
            while: (error) => error instanceof RetryableStatus,
            schedule: Schedule.exponential(500, 2)
          }),
          // Whatever survives the retries becomes a normal AiError, so callers see one error type.
          Effect.catchIf(
            (error): error is RetryableStatus => error instanceof RetryableStatus,
            (error) =>
              Effect.fail(
                fail(`Workers AI returned ${error.status} on every attempt: ${error.body}`)
              )
          )
        ),
      // Not implemented rather than faked. Nothing in this product streams: a decision is produced and
      // then stored, and a half-streamed decision is not a decision.
      streamText: () =>
        Effect.fail(fail("streaming is not implemented for Workers AI in this codebase", "streamText"))
          .pipe(Effect.forever) as never
    }))
)

// -----------------------------------------------------------------------------
// Binding — the deployed Worker
// -----------------------------------------------------------------------------

/**
 * The slice of the `AI` binding this adapter uses.
 *
 * Structural rather than importing `Ai` from `@cloudflare/workers-types`, matching `WorkersAiBinding` in
 * the embedder: it keeps Cloudflare's ambient declarations out of the modules package.
 */
export interface WorkersAiChatBinding {
  readonly run: (
    model: string,
    input: Record<string, unknown>,
    options?: { readonly gateway?: { readonly id: string } } | undefined
  ) => Promise<unknown>
}

export const LanguageModelWorkersAiBinding = (
  binding: WorkersAiChatBinding,
  model: string = WORKERS_AI_MODEL,
  /**
   * An AI Gateway id. Passed as a RUN OPTION here, not as a URL — the binding cannot be pointed at a
   * gateway hostname, so the two transports reach the same gateway by different means. Getting this wrong
   * is silent: the call succeeds, unmetered and uncached, and nothing says so.
   */
  gateway?: string
): Layer.Layer<LanguageModel.LanguageModel> =>
  Layer.effect(LanguageModel.LanguageModel)(
    LanguageModel.make({
      generateText: (options) =>
        Effect.gen(function*() {
          const messages = yield* toMessages(options.prompt)
          const { model: _omitted, ...input } = bodyFor(options, messages, model)
          const runOptions = gateway === undefined ? undefined : { gateway: { id: gateway } }
          const raw = yield* Effect.tryPromise({
            try: () => binding.run(model, input, runOptions),
            catch: (cause) => fail(`env.AI.run failed: ${String(cause)}`)
          })
          // The binding returns the completion unwrapped, without the REST `{ success, result }` envelope.
          return yield* toParts(yield* decode(raw, 200), model)
        }),
      streamText: () =>
        Effect.fail(fail("streaming is not implemented for Workers AI in this codebase", "streamText"))
          .pipe(Effect.forever) as never
    })
  )

/** Exported for tests: the request body is the contract with the provider, so it is asserted directly. */
export const buildRequestBodyForTest = bodyFor
export const jsonSchemaForTest = jsonSchemaFor
