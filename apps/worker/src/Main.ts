/**
 * The composition root — the only file that knows both a port and its adapter.
 *
 * The `env`-to-Layer problem, and how it is solved here:
 *
 * `HttpRouter.toWebHandler` builds its layer **exactly once, lazily, on the first request** and
 * caches it in a module closure for the isolate's life, so per-request cost is a couple of
 * `Context.add` calls rather than a layer build.
 *
 * Its second parameter is typed `Context<ReqR>` where `ReqR` is whatever the *handlers* require
 * that the layer does not provide. That is real type pressure, not decoration: a store whose
 * dependency is unsatisfied shows up as a mandatory per-request argument rather than compiling and
 * failing at runtime. Two consequences worth internalising:
 *
 * 1. A handler's requirements are request-scoped, so they must be satisfied *on the handlers layer
 *    itself* (`Layer.provide(HealthHttp)`), not merely somewhere further down the pipe.
 * 2. `WorkerCtx` is deliberately left in `ReqR`, because `ExecutionContext` genuinely differs per
 *    invocation and caching it would make `waitUntil` write into a dead request.
 *
 * Note what this file is and is not. It maps each slice's ports to adapters and nothing else —
 * there is no business logic here, and every import is either a slice's public surface or this
 * app's own `platform/`. That is the property that makes a second deployment target (Node, for an
 * air-gapped client) a different composition root rather than a rewrite.
 *
 * `dispose` from `toWebHandler` is dropped on purpose: Workers offers no hook to call it.
 */
import { LanguageModelWorkersAiOpenAi } from "@ea/ai-openai/Model"
import {
  ApiV1,
  AskHttp,
  AskRpcLive,
  AssistantRpcLive,
  DataRpcLive,
  DecisionHttp,
  DecisionRpcLive,
  IdentityHttp,
  IdentityRpcLive,
  IntakeHttp,
  IntakeRpcLive,
  MessageHttp,
  MessageRpcLive,
  PlanningRpcLive,
  RoomHttp,
  RoomRpcLive,
  RPC_V1_PATH,
  RpcV1,
  SalesRpcLive,
  UsageHttp,
  UsageRpcLive
} from "@ea/api/v1"
import { HealthHttp } from "@ea/api/v1"
import { IdentityResolverLive, SessionHttp, SessionRpcLive, SessionStore } from "@ea/better-auth/Session"
import { Db } from "@ea/database/Database"
import { withDatabase } from "@ea/database/Database"
/*
 * The tier-2 parser's WebAssembly module.
 *
 * Imported HERE and nowhere else, because a `.wasm` import is resolved and compiled by the bundler — so it
 * is a platform artifact, and `packages/modules` compiles with `types: []` exactly so those cannot be
 * ambient there. wrangler compiles it at build time, which is why the adapter's `initSync` costs about a
 * millisecond rather than the hundreds a runtime compile would.
 */
import { CurrentOrg, OrgId } from "@ea/domain/Identity"
import { TelemetryNoop } from "@ea/modules/decision/domain/Telemetry"
import { DryRunAdapter } from "@ea/modules/decision/server/Execution"
import { LanguageModelWorkersAiBinding, WORKERS_AI_MODEL } from "@ea/modules/decision/server/Extraction"
import { TelemetryAnalytics } from "@ea/modules/decision/server/Telemetry"
import {
  decideStep,
  decideStepOutput,
  existingDecision,
  type ExtractOutputValue,
  extractStep,
  retrieveStep,
  settleDecision
} from "@ea/modules/decision/use-cases/Decision"
import { ReportStuckWork } from "@ea/modules/decision/use-cases/Execution"
import { DocumentParser } from "@ea/modules/intake/domain/Document"
import { BlobsR2, DocumentBucket } from "@ea/modules/intake/server/Document"
import { anydocParse, mistralOcrConfig, mistralOcrParse } from "@ea/modules/intake/server/Document"
import { AgentModel } from "@ea/modules/policy/domain/Ask"
import { ChunkerHeading } from "@ea/modules/policy/domain/Chunk"
import { AssistantConversationsAgent } from "@ea/modules/policy/server/Assistant"
import { EmbedderWorkersAiBinding } from "@ea/modules/policy/server/Embedding"
import { PolicySearchLive } from "@ea/modules/policy/use-cases/Retrieval"
import { weeklyCatchUpDue } from "@ea/modules/reporting/domain/WeeklyReport"
import { SendWeeklyReports } from "@ea/modules/reporting/use-cases/WeeklyReport"
import { isTerminal } from "@ea/modules/shared/domain/Errors"
import { EventId } from "@ea/modules/shared/domain/Event"
import type { Retrieval } from "@ea/modules/shared/domain/Retrieval"
import { CacheKv } from "@ea/modules/shared/server/Cache"
import { EmailConsole } from "@ea/modules/shared/server/Email"
import { EventQueue, QueueBus } from "@ea/modules/shared/server/Event"
import { IdsUuid } from "@ea/modules/shared/server/Ids"
import { TelemetryOtlp } from "@ea/modules/shared/server/Telemetry"
import { describeFailure, markEventDone, markEventFailed } from "@ea/modules/shared/use-cases/Event"
import { SweepEnqueueGap } from "@ea/modules/shared/use-cases/Event"
import { RealtimeUpgrade, RoomsLive } from "@ea/realtime/Server"
import { EmailResend, resendConfig } from "@ea/resend/Email"
import anydocWasm from "@firecrawl/anydoc-wasm/anydoc_wasm_bg.wasm"
import { NonRetryableError } from "cloudflare:workflows"
import type { Result } from "effect"
import { Effect, Layer, ManagedRuntime, Redacted } from "effect"
import { LanguageModel } from "effect/ai"
import { HttpRouter } from "effect/http"
import { HttpApiBuilder, HttpApiScalar } from "effect/http-api"
import { RpcSerialization, RpcServer } from "effect/rpc"
import {
  type DecideWork,
  type ExtractedFields,
  makeDecideWorkflow,
  type ProposedValue,
  type RetrievedPolicy
} from "./DecideWorkflow.ts"
import { AuthenticatedLive } from "./platform/AuthenticatedLive.ts"
import { Bindings, type Env, layerConfigProvider, WorkerCtx } from "./platform/Bindings.ts"
import { cachedDocumentTextFor, dispatchEvent } from "./platform/DispatchEvent.ts"
import { ConnectHyperdrive, ReactivityLive } from "./platform/HyperdriveConnect.ts"
import { consumeBatch, type QueueBatchLike } from "./platform/QueueHandler.ts"
import { WorkerPlatform } from "./platform/WorkerPlatform.ts"

/**
 * The bindings each slice actually needs, narrowed from `Env`.
 *
 * A slice asks for one bucket or one connection string, never the whole environment — so
 * `@ea/modules/intake/server` cannot reach Hyperdrive and `@ea/modules/iam/server` cannot reach the bucket. This
 * is the only file that holds the wide `Env` and hands out the narrow pieces.
 */
const SliceBindings = (env: Env) =>
  Layer.mergeAll(
    Layer.succeed(DocumentBucket)(env.DOCUMENTS),
    Layer.succeed(SessionStore)({
      connectionString: env.HYPERDRIVE.connectionString
    }),
    Layer.succeed(EventQueue)(env.EVENTS)
  )

/**
 * Everything STATELESS that is NOT tied to HTTP, built once per isolate.
 *
 * Split out from the HTTP layer because `queue` needs all of this and none of that: `HttpApiBuilder` and
 * `RpcServer` require `HttpRouter` and a set of per-request services that only `toWebHandler` provides, so
 * a runtime built from the full layer cannot exist outside a request. This half can, and both halves share
 * one MemoMap — so `fetch` and `queue` use one set of adapters per isolate rather than two.
 *
 * The connection is deliberately absent: a TCP socket cannot outlive the request that opened it on
 * Workers, so `Connect.open` is called inside each request's or message's own scope. `Bindings` is here
 * because `env` genuinely is stable for an isolate's lifetime.
 */
const ServicesLayer = (env: Env) =>
  Layer.mergeAll(
    // The org-scoping seam. Safe to memoise: Db itself is stateless, and its methods require SqlClient at
    // call time — which `withDatabase` supplies per request.
    Db.layer,
    // Stateless adapters. Only the SQL connection and better-auth's pool are per-request, and both are
    // acquired inside a request scope.
    ConnectHyperdrive,
    /*
     * Tier 2, replacing the text-only parser: Office formats and text-layer PDFs, converted in-Worker.
     *
     * Tier 1 is not gone — `DocumentParserAnydoc` tries `parseText` first and falls through, so a markdown
     * fixture never reaches the wasm and the eval harness stays on exactly the path it was on. What changed
     * is that a `.docx` no longer returns `UnsupportedDocument`, which was the gap that made the pipeline
     * undemonstrable on a real client's documents.
     */
    DocumentParserTiers(anydocWasm),
    IdsUuid,
    BlobsR2,
    QueueBus,
    /*
     * The models, on the BINDING transport — no fetch, no URL, no token.
     *
     * This is the answer to "why does the adapter build a Cloudflare URL": it does not, here. The REST
     * transport in those adapters exists for the eval harness, which runs in Node and cannot hold a
     * binding. In the Worker the binding *is* the authorisation, and `env.AI` is the whole declaration.
     *
     * The gateway travels as a run option rather than a hostname, because a binding cannot be pointed at
     * one. Absent means direct, unmetered and uncached — which is a real state worth being able to see,
     * so it is logged at startup rather than left implicit.
     */
    CacheKv(env.CACHE),
    /*
     * Email: Resend when it is configured, the console stub when it is not.
     *
     * **Keyed on the presence of a key, not on an environment name.** `env.dev` and staging would both be
     * "not production", and both are places a real invitation may legitimately need to arrive; a laptop and
     * CI are places no key exists. The configuration is therefore the signal, and it is the only one that
     * cannot be wrong by being out of date.
     *
     * The stub is loud (`EmailConsole` logs the whole body, links included) because its job is to make the
     * auth flows clickable with no vendor account — the same argument as the scripted language model. It is
     * also why a production deployment missing `RESEND_API_KEY` is visible rather than silent: every send
     * logs a warning saying NOT SENT.
     */
    Layer.unwrap(
      Effect.map(resendConfig, (config) => config === undefined ? EmailConsole : EmailResend(config))
    ),
    /*
     * The execution adapter. Missing until the pipeline first ran, and the compiler said so the moment the
     * cast came off `dispatchEvent` — so `decision.execute` would have dead-lettered every message exactly
     * like `document.decide` did.
     *
     * `DryRunAdapter` records what it would have done and calls nothing. It is the only adapter that exists,
     * and ADR-0013 is why the next one is not trivial: an adapter without provider-side idempotency may not
     * be enabled for a customer with auto-approve armed.
     */
    DryRunAdapter,
    /*
     * The product's own numbers. Not spans — those already exist and are exported separately below.
     *
     * `Activity` wraps every workflow step in `Effect.withSpan`, `effect/sql` traces queries and
     * `LanguageModel` traces model calls, so latency and causality come free. What none of them can report
     * is how often this system refuses and whether its refusals are grounded, which is the number a client
     * actually asks about — and per plan risk R1, a FALLING refusal rate is an alarm rather than a win.
     */
    /*
     * Optional, for the same reason OTLP export is: **telemetry must never be an availability dependency.**
     *
     * Analytics Engine needs an ACCOUNT-level opt-in before a Worker may bind it, separately from the dataset
     * (which is created on first write) and separately from the SQL read endpoint (which answered while the
     * binding was still refused). So a deploy can legitimately have no METRICS binding, and a Worker that
     * crashed at layer build because it could not report a metric would be trading the product for a graph.
     *
     * `TelemetryNoop` is safe as a fallback precisely because the port is write-only — no method returns a
     * value — so nothing downstream behaves differently. What is NOT safe is being quiet about it, which is
     * why it logs once at startup rather than silently discarding.
     */
    env.METRICS === undefined ? TelemetryNoop : TelemetryAnalytics(env.METRICS),
    /*
     * Both take the gateway, and for a while only one did. The embedder went direct while the chat adapter
     * on the next line was routed — two individually valid calls, so nothing failed and no check could
     * notice. It matters most here: the eval harness embeds the whole corpus plus 99 questions per run, so
     * the embedder is the most repeated call in the system and the one whose cache hits are worth the most
     * against a neuron allocation.
     */
    EmbedderWorkersAiBinding(env.AI, env.AI_GATEWAY),
    /*
     * The chunker `document.index` uses: heading-aware, pure domain code, and the strategy the retrieval gate
     * measured (hybrid recall 100% at k=3, ahead of the LangChain splitter above 150 characters). The eval and
     * the product therefore chunk the same way, which is what makes the gate's number mean anything here.
     */
    ChunkerHeading,
    /*
     * The conversation store, over the Agents SDK's Durable Object namespace.
     *
     * An adapter rather than glue, by the rule in AGENTS.md: it takes its binding as a parameter, so it is a
     * `server`-ring implementation of the port its slice owns. What it composes is the Durable Object NAME,
     * from `CurrentOrg` — which is why the port's methods carry that requirement and why a handler that
     * forgot the tenant would not compile (ADR-0025).
     */
    AssistantConversationsAgent(env.ASSISTANTS),
    LanguageModelWorkersAiBinding(env.AI, WORKERS_AI_MODEL, env.AI_GATEWAY),
    /*
     * The agent's model, under its OWN tag — see `policy/domain/Ask/AgentModel.ts`.
     *
     * A different adapter for a different requirement: the decide pipeline above uses the binding (no token,
     * no egress, never needs tools), while the agent needs tool calling and therefore the OpenAI-compatible
     * surface. Two layers under one `LanguageModel` tag would mean the last wins and the loser fails
     * silently, which is why they are two tags and why this line is the only place the choice is made.
     *
     * Republished under `AgentModel` rather than built twice: the adapter's layer provides `LanguageModel`,
     * and this takes that service and offers it under the agent's tag.
     */
    Layer.effect(AgentModel)(Effect.map(LanguageModel.LanguageModel, (model) => model)).pipe(
      Layer.provide(LanguageModelWorkersAiOpenAi)
    )
  ).pipe(
    Layer.provideMerge(SliceBindings(env)),
    Layer.provideMerge(Layer.succeed(Bindings)(env)),
    Layer.provideMerge(ReactivityLive),
    /*
     * Span export, when an endpoint is configured.
     *
     * `Layer.empty` when it is not: a Worker that refused to start without an observability backend would
     * make telemetry an availability dependency, which is the wrong trade for a drain.
     */
    Layer.provide(
      env.OTLP_ENDPOINT === undefined ? Layer.empty : TelemetryOtlp({
        endpoint: env.OTLP_ENDPOINT,
        headers: env.OTLP_HEADERS === undefined ? undefined : Redacted.make(env.OTLP_HEADERS),
        serviceVersion: env.VERSION
      })
    ),
    Layer.provide(layerConfigProvider(env))
  )

/** Every v1 HTTP edge. */
const HttpEdges = Layer.mergeAll(
  HealthHttp,
  IdentityHttp,
  IntakeHttp,
  DecisionHttp,
  RoomHttp,
  MessageHttp,
  AskHttp,
  UsageHttp
)

/** Every v1 RPC edge. The agent brings its own language model, locally — see AskRpcLive.ts. */
const RpcEdges = Layer.mergeAll(
  IdentityRpcLive,
  IntakeRpcLive,
  DecisionRpcLive,
  MessageRpcLive,
  RoomRpcLive,
  AskRpcLive,
  AssistantRpcLive,
  UsageRpcLive,
  SalesRpcLive,
  DataRpcLive,
  PlanningRpcLive
)

/** The HTTP and RPC surfaces, over the shared services. */
const AppLayer = (env: Env) =>
  Layer.mergeAll(
    HttpApiBuilder.layer(ApiV1, { openapiPath: "/api/v1/openapi.json" }),
    /*
     * The API reference, at `/api/v1/docs`, rendered by Scalar from the same document.
     *
     * `layerCdn` and not `layer`: the non-CDN variant INLINES Scalar's whole bundle into this Worker's
     * script, and the script is what every cold start has to load. A docs page nobody hits on the hot
     * path is the wrong thing to pay for on every request, so the reference loads from jsDelivr and the
     * Worker stays small. The spec itself is served by us — Scalar only renders it — so the CDN sees no
     * request content and going down costs the docs page and nothing else.
     *
     * PLAN.md asks for exactly this ("OpenAPI + Scalar docs, derived from the same declaration that types
     * the handlers, so docs cannot drift"). Until now the document was served and nothing read it.
     */
    HttpApiScalar.layerCdn(ApiV1, { path: "/api/v1/docs" }),
    /*
     * The RPC surface, on the SAME router as the HTTP API.
     *
     * One origin, one auth seam, one deploy — and the reason both transports are cheap to keep: they
     * resolve to the same `CurrentUser` and call the same use cases, so the second transport adds a
     * door rather than a parallel implementation. HTTP stays frozen and snake_case for callers we do
     * not control; RPC carries domain types for the console, which ships with the server.
     */
    RpcServer.layerHttp({
      group: RpcV1,
      path: RPC_V1_PATH,
      /*
       * `protocol` is NOT optional in practice. Despite the name, `layerHttp` mounts a **WebSocket**
       * endpoint when this is omitted (`protocol === "http" ? layerProtocolHttp : layerProtocolWebsocket`),
       * so a plain POST gets a 404 with nothing in the logs to explain it.
       *
       * Request/response rather than a socket because the console's calls are discrete queries, and a
       * Worker billed on wall-clock time should not hold an idle socket open per viewer. A socket
       * becomes right when the queue needs live updates, and that is a one-word change here.
       */
      protocol: "http"
    }),
    /*
     * The realtime upgrade. On this router, so it shares the origin — and therefore the cookie — with
     * everything else; a socket that had to authenticate differently from a request would be a second
     * authorization seam (see RealtimeHttp.ts).
     */
    RealtimeUpgrade(env.ROOMS),
    // better-auth's own routes, on the same router as the API — they must share an origin with each other
    // whatever the console does, because the session cookie is set by one and read by the other.
    SessionHttp
  ).pipe(
    /*
     * CORS, and ONLY when the console is a different origin.
     *
     * `Layer.empty` otherwise, which is the local and proxied shapes — ADR-0001's point was that the settings
     * you do not have cannot be wrong. When the API is its own subdomain they are unavoidable, so they are
     * here, narrow:
     *
     *   - an explicit origin, never `*`. A wildcard is INVALID with credentials: browsers refuse the response,
     *     so it would not be permissive, it would be broken while looking permissive.
     *   - `credentials: true`, because the session is a cookie.
     *
     * Note this is a GLOBAL middleware on the router, so it also covers better-auth's mounted routes and the
     * RPC endpoint. A CORS policy that covered the API but not the login route would fail at exactly the
     * moment a user tried to sign in.
     */
    Layer.provide(
      env.CONSOLE_ORIGIN === undefined ? Layer.empty : HttpRouter.cors({
        allowedOrigins: [env.CONSOLE_ORIGIN],
        credentials: true
      })
    ),
    /*
     * Merged into two groups rather than listed one per `Layer.provide`, and that is forced: `pipe` accepts at
     * most twenty arguments, and the full REST surface put this chain over it. Grouping by TRANSPORT keeps the
     * list readable — every HTTP edge, then every RPC edge — and they are independent contributions to the same
     * router, so merging changes nothing about how they compose.
     */
    Layer.provide(HttpEdges),
    Layer.provide(RpcEdges),
    /*
     * The authorization seam, provided HERE rather than beside `IdentityResolverLive` below — order in this pipe
     * is what satisfies requirements, and this middleware needs the resolver, so it has to come before the layer
     * that supplies one.
     */
    Layer.provide(AuthenticatedLive),
    // JSON rather than msgpack: the console is a browser, the payloads are small, and a wire format a
    // human can read in devtools is worth more here than a few bytes.
    Layer.provide(RpcSerialization.layerJson),
    Layer.provide(RoomsLive(env.ROOMS)),
    /*
     * The identity port, which the realtime upgrade requires and no middleware provides.
     *
     * Its absence was a compile error at the per-request door rather than a 500 at runtime — `toWebHandler`
     * types the leftover requirements, so a service the app needs and the layer does not supply cannot ship.
     * That is the property the whole composition-root shape exists for, and this is it paying off.
     *
     * **`provideMerge`, not `provide`**, and the difference is exactly what the door was reporting. A route
     * handler's requirements are resolved from the app layer's OUTPUT context, because the handler runs per
     * request rather than at layer-build time. `provide` satisfies the layers above and keeps the service to
     * itself; `provideMerge` also leaves it in the output, where the router can find it. `SessionStore` is in
     * the graph for the same reason — `ServicesLayer` is merged, not provided.
     */
    Layer.provideMerge(IdentityResolverLive),
    Layer.provide(SessionRpcLive),
    Layer.provideMerge(ServicesLayer(env)),
    Layer.provide(WorkerPlatform)
  )

/**
 * One shared MemoMap so `fetch`, `queue` and `scheduled` share a single layer graph.
 */
const memoMap = Layer.makeMemoMapUnsafe()

/** Monday 06:00 UTC. Must equal the second cron in every environment's `triggers` in `wrangler.jsonc`. */
const WEEKLY_REPORT_CRON = "0 6 * * MON"

let webHandler: ReturnType<typeof makeHandler> | undefined

const makeHandler = (env: Env) => HttpRouter.toWebHandler(AppLayer(env), { memoMap }).handler

/**
 * Binding objects are stable for an isolate's lifetime, so memoising on the first invocation is
 * correct. `ExecutionContext` is not, which is why it travels per request instead.
 */
const getHandler = (env: Env) => (webHandler ??= makeHandler(env))

/**
 * The runtime for non-HTTP entry points.
 *
 * `queue` and `scheduled` share the SAME layer graph as `fetch` through the MemoMap above, so there is one
 * set of adapters per isolate rather than three. What they do not share is a request: each invocation opens
 * its own database connection inside its own scope, which is the constraint that shaped this whole file.
 */
let queueRuntime: ReturnType<typeof makeQueueRuntime> | undefined
/*
 * A `ManagedRuntime` over the SAME MemoMap as the web handler.
 *
 * That shared map is the whole point: `fetch` and `queue` then use one set of adapters per isolate rather
 * than two. `toWebHandler` exposes only a handler, so a runtime is built separately — but pointing both at
 * one MemoMap keeps them a single graph, which is what the composition root promised.
 */
const makeQueueRuntime = (env: Env) => ManagedRuntime.make(ServicesLayer(env), { memoMap })
const getQueueRuntime = (env: Env) => (queueRuntime ??= makeQueueRuntime(env))

/**
 * The room class, re-exported from the entry because that is how the runtime finds it.
 *
 * A Durable Object class must be an export of the Worker's main module; `exports` in wrangler.jsonc only
 * declares what to provision for it. A class that exists but is not exported here is not an error at deploy
 * — Cloudflare ignores a class it was not told about — so the failure would be a namespace that never
 * appears and an `env.ROOMS` that is undefined at the first upgrade.
 */
export { RoomDurableObject } from "./RoomDurableObject.ts"
/*
 * Exported from the entry for the same reason: a Durable Object class must be exported from the Worker's
 * main module and declared in `exports`, or the namespace has nothing to instantiate. An `Agent` is a
 * Durable Object — the SDK's class extends it — so it obeys exactly the same rule.
 */
export { AssistantAgent } from "./AssistantAgent.ts"

/**
 * The parser, as the ordered tiers this deployment has.
 *
 * Composed HERE rather than inside an adapter, because the order of tiers is a deployment decision and the
 * composition root is where a reader should be able to see it:
 *
 *   text → anydoc (wasm, in-Worker) → OCR (Mistral, paid, EU), when a key is configured
 *
 * Each tier runs only if the one before it refused, so a markdown document never touches the wasm and a
 * `.docx` never becomes a paid API call. **OCR is absent unless configured**, which is the right default
 * for a tier that bills per page and whose use is a per-client residency decision (ADR-0006).
 *
 * `Layer.effect` rather than `Layer.succeed` because whether tier 3 exists is read from config, and the
 * parsed-text cache key depends on the answer — see `DispatchEvent`, where enabling OCR is a key change.
 */
const DocumentParserTiers = (wasmModule: unknown) =>
  Layer.effect(DocumentParser)(
    Effect.map(mistralOcrConfig, (ocr) => {
      const inWorker = anydocParse(wasmModule)
      return { parse: ocr === undefined ? inWorker : mistralOcrParse(ocr, inWorker) }
    })
  )

/**
 * The decide pipeline's work, bound to this isolate's runtime and to one tenant.
 *
 * This is the join `DecideWorkflow.ts` deliberately does not make: that file names no port and no service,
 * so the Effect plumbing lives here, in the composition root, where every other adapter binding is.
 *
 * `withDatabase` per call rather than one connection for the whole instance — the reasoning is in
 * `DecideWorkflow.ts`, and it corrects ADR-0024: a `step.do` callback is an async function, so an Effect
 * scope cannot span the steps without inverting control, and Hyperdrive opens in single-digit milliseconds.
 *
 * `CurrentOrg` comes from the params, because a Workflow instance has no session and no event row. That is
 * the one place the tenancy seam is weaker than elsewhere in this repo: whoever creates the instance is
 * trusted to have resolved the tenant, exactly as the queue consumer is today.
 */
const decideWork = (env: Env, orgId: string): DecideWork => {
  const runtime = getQueueRuntime(env)

  /**
   * Runs one step's effect, and **translates its typed failure into the platform's retry vocabulary.**
   *
   * This is where ADR-0024's hardest loss is paid. A step boundary is a `Promise`, so
   * `shared/domain/Errors/Terminal.ts`'s terminal-versus-retryable union cannot cross it as a typed channel
   * — and losing the distinction would be a real regression, because the queue consumer branches on it
   * today. docket burned three model calls on every deterministic bug for exactly this reason.
   *
   * `Effect.result` converts the failure into a value so nothing is lost, and then the SAME `isTerminal`
   * predicate the queue uses decides which error class to throw:
   *
   *   terminal   → `NonRetryableError`, which fails the instance immediately. A `DocumentRowMissing` will
   *                fail identically on every attempt, so five attempts is five times the cost of one.
   *   otherwise  → a plain `Error`, which the step's retry policy handles.
   *
   * `describeFailure` rather than `failure.message`, and imported rather than rewritten: a
   * `Schema.TaggedError` is an `Error` whose `.message` is usually EMPTY, so the obvious version records a
   * blank reason (AGENTS.md records this trap). One definition, shared with the queue path, so the two
   * cannot describe the same failure differently.
   */
  const run = <A, E, R>(effect: Effect.Effect<A, E, R>): Promise<A> =>
    runtime.runPromise(
      Effect.result(
        withDatabase(effect).pipe(
          Effect.provideService(CurrentOrg, OrgId.make(orgId)),
          Effect.provide(PolicySearchLive)
        )
      ) as Effect.Effect<Result.Result<A, E>, never, never>
    ).then((result) => {
      if (result._tag === "Success") return result.success
      const reason = describeFailure(result.failure)
      throw isTerminal(result.failure) ? new NonRetryableError(reason) : new Error(reason)
    })

  /*
   * The casts are all here, and all in one direction: the module's typed values into the platform's
   * serialised view, and back. `DecideWorkflow.ts` declares that view because `step.do` checks
   * serializability with a mapped type and cannot see through `unknown` — so this is the one place the two
   * descriptions of the same bytes are joined, which is what makes it the right place for a cast.
   */
  return {
    existing: (params) => run(existingDecision(params)),
    // The same derivation the queue path runs, so a document parsed by the workflow and one parsed by the
    // queue are the same bytes — which is what `source_span` is checked against.
    /*
     * Through the CACHE, not the raw derivation.
     *
     * The step memo covers a retry within one instance; this covers two different events naming the same
     * document, which the memo cannot see. The key carries the parser version AND whether OCR is
     * configured, so a deployment that turns OCR on cannot read text produced without it.
     */
    parse: (params) => run(Effect.flatMap(mistralOcrConfig, (ocr) => cachedDocumentTextFor(params.documentId, ocr))),
    extract: (_params, documentText) => run(extractStep({ documentText })) as Promise<ExtractedFields>,
    retrieve: (_params, query) => run(retrieveStep(query)) as Promise<RetrievedPolicy>,
    decide: (_params, fields, policy) =>
      run(decideStep({ fields, chunks: (policy as unknown as Retrieval).chunks })) as Promise<ProposedValue>,
    settle: (params, extraction, retrieval, proposal, startedAt) =>
      run(settleDecision({
        payload: params,
        extraction: extraction as unknown as ExtractOutputValue,
        retrieval: retrieval as unknown as Retrieval,
        // Either memoised shape — see `decideStepOutput` for why an in-flight instance can still hand over the old one.
        ...decideStepOutput(proposal),
        startedAt
      })),
    /*
     * The event row's finish, which the queue can no longer write.
     *
     * The SAME two functions `ConsumeEvent` uses, imported rather than rewritten: two definitions of "done"
     * would drift, and the one that drifted would be the one nothing reads until an operator asks why a
     * decision looks unfinished.
     */
    finish: (params) => run(Effect.asVoid(markEventDone(EventId.make(params.eventId)))),
    fail: (params, reason) => run(Effect.asVoid(markEventFailed(EventId.make(params.eventId), reason)))
  }
}

/**
 * The Workflow class, created here for the reason `DecideWorkflow.ts` explains: a `WorkflowEntrypoint` is
 * instantiated by the runtime, so nothing can be handed to it, and importing this file from there would be
 * a cycle with the export below.
 *
 * Exported from the entry like the two Durable Object classes, and declared in `wrangler.jsonc`'s
 * `workflows` array. NOT yet the path production takes — the queue still runs the pipeline inline. Flipping
 * it needs parsing to move into a step first, because Workflow params are persisted and a large document's
 * text would approach the 1 MiB cap.
 */
export const DecideWorkflow = makeDecideWorkflow(decideWork)

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // The per-request door.
    return getHandler(env)(request, WorkerCtx.context(ctx))
  },

  /**
   * The queue consumer.
   *
   * Every message is acked or retried **individually** — see QueueHandler.ts for why `ackAll`/`retryAll`
   * are never used. What each message *does* is `dispatchEvent`, which is the piece that was missing:
   * this handler used to pass a constant `Done`, so every message was acked unprocessed and the deployed
   * Worker could not decide a document even though the pipeline was built and tested
   * (docs/services.md §3.1).
   */
  async queue(
    batch: QueueBatchLike,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    await getQueueRuntime(env).runPromise(consumeBatch(batch, dispatchEvent(env.DECIDE)))
  },

  /**
   * The cron. Recovery work only — it never decides anything.
   *
   * One job today: re-send events that were recorded but never enqueued. No transaction spans the
   * `events` insert and `queue.send`, so a committed row can have no message behind it, and `EmitEvent`
   * swallows a send failure on purpose — propagating would roll the caller back and destroy the row that
   * makes recovery possible. This is what notices. See `SweepEnqueueGap`.
   *
   * It shares the SAME layer graph as `fetch` and `queue` through the MemoMap, which is what this file
   * promised three entrypoints ago and is now actually true of all three.
   *
   * `runPromise` rather than `waitUntil`: a cron invocation's whole purpose is this work, so there is
   * nothing to return early for, and failing loudly puts the error in the cron's own logs where an
   * operator looking at a missed schedule will find it.
   */
  async scheduled(
    controller: { readonly cron: string },
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    /*
     * The Monday report has its own trigger rather than riding the five-minute sweep: it is once a week, and a
     * cross-tenant read every five minutes to discover that nothing is due would be the wrong trade. Dispatched by
     * the trigger's expression, which must match `wrangler.jsonc` exactly in every environment.
     */
    if (controller.cron === WEEKLY_REPORT_CRON) {
      await getQueueRuntime(env).runPromise(
        withDatabase(Effect.gen(function*() {
          const summary = yield* SendWeeklyReports(new Date())
          // Logged including zeros, for the same reason as the sweeper below: silence looks like a dead cron.
          yield* Effect.log(
            `cron ${controller.cron}: weekly reports for ${summary.period.from}..${summary.period.to} — ` +
              `${summary.sent} sent, ${summary.alreadySent} already sent, ${summary.failed} failed` +
              (summary.more ? " — LIMIT HIT, the five-minute cron continues" : "")
          )
        }))
      )
      return
    }
    await getQueueRuntime(env).runPromise(
      /*
       * TWO jobs now, in one connection and in this order.
       *
       * The sweeper first, because re-sending a never-started event is cheap and might clear work the
       * reporter would otherwise shout about. Then the report, which touches nothing (ADR-0013) and exists
       * to put ids in front of a human.
       *
       * One `withDatabase` around both: a cron invocation is one connection's worth of work, and opening a
       * second would double the per-tick cost of the thing least worth optimising.
       */
      withDatabase(Effect.gen(function*() {
        const swept = yield* SweepEnqueueGap
        /*
         * `Effect.log`, not `console.log`: it goes through the logger the OTLP drain already consumes, so
         * the cron's output lands in telemetry rather than only in stdout — which matters for the one
         * thing here worth alerting on.
         *
         * Logged unconditionally, INCLUDING the zero. Zero is the healthy steady state, and a silent
         * success is indistinguishable from a cron that is not running at all — the exact failure this
         * handler exists to prevent. A persistently non-zero `resent` is the alarm: work is being
         * re-sent and still not completing.
         */
        yield* Effect.log(
          `cron ${controller.cron}: re-sent ${swept.resent} unenqueued event(s)` +
            (swept.more ? " — LIMIT HIT, a backlog remains for the next tick" : "")
        )

        /*
         * The stuck-work report, promised by `ExecutionTable.ts` and required by ADR-0013 — and now also
         * the only thing that notices an `events` row whose Workflow instance never came back, a state the
         * queue flip created on 2026-09-30.
         *
         * It logs one WARNING per stuck item with the ids; this line is the count, logged including zero
         * for the same reason the sweeper's is.
         */
        const stuck = yield* ReportStuckWork
        yield* Effect.log(
          `cron ${controller.cron}: ${stuck.pendingExecutions} ambiguous execution claim(s), ` +
            `${stuck.stuckEvents} event(s) stuck in processing` +
            (stuck.more ? " — LIMIT HIT, more remain" : "")
        )

        /*
         * The weekly report's catch-up: on Mondays from 06:00 UTC, finish what the weekly run's bound left. A run
         * skips organizations already claimed, so once everyone has their report this is one cheap query. Logged
         * only when it sent something, so the five-minute log is not filled with zeros all Monday.
         */
        if (weeklyCatchUpDue(new Date())) {
          const caughtUp = yield* SendWeeklyReports(new Date())
          if (caughtUp.sent + caughtUp.failed > 0) {
            yield* Effect.log(
              `cron ${controller.cron}: weekly report catch-up — ${caughtUp.sent} sent, ${caughtUp.failed} failed` +
                (caughtUp.more ? ", more remain" : "")
            )
          }
        }
      }))
    )
  }
} satisfies ExportedHandler<Env>
