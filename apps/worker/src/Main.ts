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
import {
  ApiV1,
  AskRpcLive,
  DecisionRpcLive,
  IdentityHttp,
  IdentityRpcLive,
  IntakeHttp,
  IntakeRpcLive,
  MessageRpcLive,
  RoomRpcLive,
  RPC_V1_PATH,
  RpcV1
} from "@ea/api/v1"
import { TelemetryNoop } from "@ea/modules/decision/domain/Telemetry"
import { DryRunAdapter } from "@ea/modules/decision/server/Execution"
import { LanguageModelWorkersAiBinding, WORKERS_AI_MODEL } from "@ea/modules/decision/server/Extraction"
import {
  IdentityResolverLive,
  SessionHttp,
  SessionLive,
  SessionRpcLive,
  SessionStore
} from "@ea/modules/iam/server/Session"
import { DocumentParserText } from "@ea/modules/intake/domain/Document"
import { BlobsR2, DocumentBucket } from "@ea/modules/intake/server/Document"
import { AgentModel } from "@ea/modules/policy/domain/Ask"
import { EmbedderWorkersAiBinding } from "@ea/modules/policy/server/Embedding"
import { RealtimeUpgrade, RoomsLive } from "@ea/modules/realtime/server/Room"
import { LanguageModelWorkersAiOpenAi } from "@ea/modules/shared/server/Model"
import { Db } from "@ea/modules/shared/tables/Database"
import { withDatabase } from "@ea/modules/shared/tables/Database"
import { SweepEnqueueGap } from "@ea/modules/shared/use-cases/Event"
import { Effect, Layer, ManagedRuntime, Redacted } from "effect"
import { LanguageModel } from "effect/ai"
import { HttpRouter } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { RpcSerialization, RpcServer } from "effect/rpc"
import { HealthHttp } from "./Health/HealthHttp.ts"
import { Bindings, type Env, layerConfigProvider, WorkerCtx } from "./platform/Bindings.ts"
import { CacheKv } from "./platform/CacheKv.ts"
import { dispatchEvent } from "./platform/DispatchEvent.ts"
import { ConnectHyperdrive, ReactivityLive } from "./platform/HyperdriveConnect.ts"
import { IdsUuid } from "./platform/Ids.ts"
import { EventQueue, QueueBus } from "./platform/QueueBus.ts"
import { consumeBatch, type QueueBatchLike } from "./platform/QueueHandler.ts"
import { TelemetryAnalytics } from "./platform/TelemetryAnalytics.ts"
import { TelemetryOtlp } from "./platform/TelemetryOtlp.ts"
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
    DocumentParserText,
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
    EmbedderWorkersAiBinding(env.AI),
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

/** The HTTP and RPC surfaces, over the shared services. */
const AppLayer = (env: Env) =>
  Layer.mergeAll(
    HttpApiBuilder.layer(ApiV1, { openapiPath: "/api/v1/openapi.json" }),
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
    Layer.provide(HealthHttp),
    Layer.provide(IdentityHttp),
    Layer.provide(IntakeHttp),
    Layer.provide(IdentityRpcLive),
    Layer.provide(IntakeRpcLive),
    Layer.provide(DecisionRpcLive),
    Layer.provide(MessageRpcLive),
    Layer.provide(RoomRpcLive),
    // The agent. Brings its own language model, locally — see AskRpcLive.ts.
    Layer.provide(AskRpcLive),
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
    Layer.provide(SessionLive),
    Layer.provide(SessionRpcLive),
    Layer.provideMerge(ServicesLayer(env)),
    Layer.provide(WorkerPlatform)
  )

/**
 * One shared MemoMap so `fetch`, `queue` and `scheduled` share a single layer graph.
 */
const memoMap = Layer.makeMemoMapUnsafe()

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
    await getQueueRuntime(env).runPromise(consumeBatch(batch, dispatchEvent))
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
    await getQueueRuntime(env).runPromise(
      Effect.flatMap(withDatabase(SweepEnqueueGap), (result) =>
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
        Effect.log(
          `cron ${controller.cron}: re-sent ${result.resent} unenqueued event(s)` +
            (result.more ? " — LIMIT HIT, a backlog remains for the next tick" : "")
        ))
    )
  }
} satisfies ExportedHandler<Env>
