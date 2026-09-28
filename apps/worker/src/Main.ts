/**
 * The composition root — the only file that knows both a port and its adapter.
 *
 * The `env`-to-Layer problem, and how it is solved here:
 *
 * `HttpRouter.toWebHandler` builds its layer **exactly once, lazily, on the first request**
 * and caches it in a module closure for the isolate's life, so per-request cost is a couple
 * of `Context.add` calls rather than a layer build.
 *
 * Its second parameter is typed `Context<ReqR>` where `ReqR` is whatever the *handlers*
 * require that the layer does not provide. That is real type pressure, not decoration: a
 * store whose dependency is unsatisfied shows up as a mandatory per-request argument rather
 * than compiling and failing at runtime. Two consequences worth internalising:
 *
 * 1. A handler's requirements are request-scoped, so they must be satisfied *on the handlers
 *    layer itself* (`HealthHandlers.pipe(Layer.provide(Pg))`), not merely somewhere further
 *    down the pipe.
 * 2. `WorkerCtx` is deliberately left in `ReqR`, because `ExecutionContext` genuinely differs
 *    per invocation and caching it would make `waitUntil` write into a dead request.
 *
 * `dispose` from `toWebHandler` is dropped on purpose: Workers offers no hook to call it.
 */
import { ApiV1 } from "@ea/shared-domain/api"
import { Layer } from "effect"
import { HttpRouter } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { HealthHandlers } from "./health/HealthHandlers.ts"
import { Bindings, type Env, layerConfigProvider, WorkerCtx } from "./platform/Bindings.ts"
import { ReactivityLive } from "./platform/Database.ts"
import { WorkerPlatform } from "./platform/WorkerPlatform.ts"

/**
 * Everything STATELESS, built once per isolate.
 *
 * The database is deliberately absent: a TCP socket cannot outlive the request that opened it
 * on Workers, so `withDatabase` builds a client per request instead (see platform/Database.ts).
 * `Bindings` is here because `env` genuinely is stable for an isolate's lifetime.
 */
const AppLayer = (env: Env) =>
  HttpApiBuilder.layer(ApiV1, { openapiPath: "/api/v1/openapi.json" }).pipe(
    Layer.provide(HealthHandlers),
    Layer.provideMerge(Layer.succeed(Bindings)(env)),
    Layer.provideMerge(ReactivityLive),
    Layer.provide(WorkerPlatform),
    Layer.provide(layerConfigProvider(env))
  )

/**
 * One shared MemoMap so `fetch`, `queue` and `scheduled` share a single layer graph —
 * one PgClient and one prepared-statement cache per isolate rather than three.
 */
const memoMap = Layer.makeMemoMapUnsafe()

let webHandler: ReturnType<typeof makeHandler> | undefined

const makeHandler = (env: Env) => HttpRouter.toWebHandler(AppLayer(env), { memoMap }).handler

/**
 * Binding objects are stable for an isolate's lifetime, so memoising on the first invocation
 * is correct. `ExecutionContext` is not, which is why it travels per request instead.
 */
const getHandler = (env: Env) => (webHandler ??= makeHandler(env))

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // The per-request door.
    return getHandler(env)(request, WorkerCtx.context(ctx))
  }
} satisfies ExportedHandler<Env>
