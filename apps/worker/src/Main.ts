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
import { ApiV1, IdentityHttp, IdentityRpcLive, IntakeHttp, IntakeRpcLive, RPC_V1_PATH, RpcV1 } from "@ea/api/v1"
import { SessionHttp, SessionLive, SessionRpcLive, SessionStore } from "@ea/modules/iam/server/Session"
import { DocumentParserText } from "@ea/modules/intake/domain/Document"
import { BlobsR2, DocumentBucket } from "@ea/modules/intake/server/Document"
import { Db } from "@ea/modules/shared/tables/Database"
import { Layer } from "effect"
import { HttpRouter } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { RpcSerialization, RpcServer } from "effect/rpc"
import { HealthHttp } from "./Health/Health.http.ts"
import { Bindings, type Env, layerConfigProvider, WorkerCtx } from "./platform/Bindings.ts"
import { ConnectHyperdrive, ReactivityLive } from "./platform/HyperdriveConnect.ts"
import { IdsUuid } from "./platform/Ids.ts"
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
    Layer.succeed(SessionStore)({ connectionString: env.HYPERDRIVE.connectionString })
  )

/**
 * Everything STATELESS, built once per isolate.
 *
 * The connection is deliberately absent: a TCP socket cannot outlive the request that opened it on
 * Workers, so `Connect.open` is called inside each request's scope instead. `Bindings` is here
 * because `env` genuinely is stable for an isolate's lifetime.
 */
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
    // JSON rather than msgpack: the console is a browser, the payloads are small, and a wire format
    // a human can read in devtools is worth more here than a few bytes.
    Layer.provide(RpcSerialization.layerJson),
    Layer.provide(SessionLive),
    Layer.provide(SessionRpcLive),
    // The org-scoping seam. Safe to memoise: Db itself is stateless, and its methods require
    // SqlClient at call time — which `withDatabase` supplies per request.
    Layer.provideMerge(Db.layer),
    // Stateless adapters: safe to memoise. Only the SQL connection and better-auth's pool are
    // per-request, and both are acquired inside a request scope.
    Layer.provideMerge(ConnectHyperdrive),
    Layer.provideMerge(DocumentParserText),
    Layer.provideMerge(IdsUuid),
    Layer.provideMerge(BlobsR2),
    Layer.provideMerge(SliceBindings(env)),
    Layer.provideMerge(Layer.succeed(Bindings)(env)),
    Layer.provideMerge(ReactivityLive),
    Layer.provide(WorkerPlatform),
    Layer.provide(layerConfigProvider(env))
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

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // The per-request door.
    return getHandler(env)(request, WorkerCtx.context(ctx))
  }
} satisfies ExportedHandler<Env>
