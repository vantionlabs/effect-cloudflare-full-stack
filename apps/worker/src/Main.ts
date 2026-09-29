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
  DecisionRpcLive,
  IdentityHttp,
  IdentityRpcLive,
  IntakeHttp,
  IntakeRpcLive,
  RPC_V1_PATH,
  RpcV1
} from "@ea/api/v1"
import { SessionHttp, SessionLive, SessionRpcLive, SessionStore } from "@ea/modules/iam/server/Session"
import { DocumentParserText } from "@ea/modules/intake/domain/Document"
import { BlobsR2, DocumentBucket } from "@ea/modules/intake/server/Document"
import { Db } from "@ea/modules/shared/tables/Database"
import { Effect, Layer, ManagedRuntime } from "effect"
import { HttpRouter } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { RpcSerialization, RpcServer } from "effect/rpc"
import { HealthHttp } from "./Health/Health.http.ts"
import { Bindings, type Env, layerConfigProvider, WorkerCtx } from "./platform/Bindings.ts"
import { ConnectHyperdrive, ReactivityLive } from "./platform/HyperdriveConnect.ts"
import { IdsUuid } from "./platform/Ids.ts"
import { EventQueue, QueueBus } from "./platform/QueueBus.ts"
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
    Layer.succeed(SessionStore)({ connectionString: env.HYPERDRIVE.connectionString }),
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
    QueueBus
  ).pipe(
    Layer.provideMerge(SliceBindings(env)),
    Layer.provideMerge(Layer.succeed(Bindings)(env)),
    Layer.provideMerge(ReactivityLive),
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
    // better-auth's own routes, mounted on the same router so there is one origin and no CORS.
    SessionHttp
  ).pipe(
    Layer.provide(HealthHttp),
    Layer.provide(IdentityHttp),
    Layer.provide(IntakeHttp),
    Layer.provide(IdentityRpcLive),
    Layer.provide(IntakeRpcLive),
    Layer.provide(DecisionRpcLive),
    // JSON rather than msgpack: the console is a browser, the payloads are small, and a wire format a
    // human can read in devtools is worth more here than a few bytes.
    Layer.provide(RpcSerialization.layerJson),
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

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // The per-request door.
    return getHandler(env)(request, WorkerCtx.context(ctx))
  },

  /**
   * The queue consumer.
   *
   * Every message is acked or retried **individually** — see QueueHandler.ts for why `ackAll`/`retryAll`
   * are never used. The work each message triggers is not wired yet: `document.decide` runs the decide
   * pipeline at step 9, when the execute branch lands and both paths provably call one function. Until
   * then a message is read, recorded and acked, which is enough to prove the plumbing and the batch
   * semantics without pretending the pipeline is connected.
   */
  async queue(batch: QueueBatchLike, env: Env, _ctx: ExecutionContext): Promise<void> {
    await getQueueRuntime(env).runPromise(
      consumeBatch(batch, () => Effect.succeed({ _tag: "Done" as const }))
    )
  }
} satisfies ExportedHandler<Env>
