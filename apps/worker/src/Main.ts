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
import { PgClient } from "@effect/sql-pg"
import { Layer } from "effect"
import { HttpRouter } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { HealthHandlers } from "./health/HealthHandlers.ts"
import { type Env, layerConfigProvider, WorkerCtx } from "./platform/Bindings.ts"
import { pgConfigFor } from "./platform/CloudflareSocket.ts"
import { WorkerPlatform } from "./platform/WorkerPlatform.ts"

/** Everything reachable from the bindings. Built once per isolate. */
const AppLayer = (env: Env) => {
  // One PgClient per isolate. The prepared-statement cache inside it is the thing being
  // kept: rebuilding per request would discard it on every invocation.
  const Database = PgClient.layer(pgConfigFor(env.HYPERDRIVE))

  // `provideMerge`, not `provide`: `toWebHandler` computes the per-request context as
  // whatever the handlers require MINUS what the layer *outputs*. A plain `provide`
  // satisfies the dependency but drops SqlClient from the output, so it reappears as a
  // mandatory per-request argument. Merging keeps it in the output where it belongs.
  return HttpApiBuilder.layer(ApiV1, { openapiPath: "/api/v1/openapi.json" }).pipe(
    Layer.provide(HealthHandlers),
    Layer.provideMerge(Database),
    Layer.provide(WorkerPlatform),
    Layer.provide(layerConfigProvider(env))
  )
}

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
