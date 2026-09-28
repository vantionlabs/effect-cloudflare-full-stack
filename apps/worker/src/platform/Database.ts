/**
 * Per-request database access, and why it cannot be per-isolate.
 *
 * **A TCP socket opened during one request cannot be reused in another on Workers.**
 * Outbound connections are tied to the request's I/O context. Memoising a `PgClient` for the
 * isolate's lifetime — to keep its prepared-statement cache — therefore fails in a way that
 * is easy to miss: the first request succeeds, the second returns a degraded result, and the
 * third **hangs the Worker** ("detected that your Worker's code had hung"). A single manual
 * request will not reveal it; three consecutive ones will.
 *
 * So the client is built per request and released with the request scope. The
 * prepared-statement cache is lost, which is the real cost — but that is precisely the work
 * Hyperdrive does on our behalf: it keeps the pool warm *outside* the Worker, so opening a
 * connection per request costs a p90 4 ms handshake instead of a full round trip to the
 * origin region.
 *
 * Worth noting that Effect's types said this first. `HttpRouter.toWebHandler` reported
 * `SqlClient` as a required *per-request* service; that was correct, and an earlier
 * `Layer.provideMerge` silenced it rather than listening to it.
 */
import { PgClient } from "@effect/sql-pg"
import { Effect, type Layer } from "effect"
import * as ReactivityModule from "effect/reactivity/Reactivity"
import { SqlClient } from "effect/sql"
import { Bindings } from "./Bindings.ts"
import { pgConfigFor } from "./CloudflareSocket.ts"

/** Stateless and safe to memoise for the isolate. */
export const ReactivityLive: Layer.Layer<ReactivityModule.Reactivity> = ReactivityModule.layer

/**
 * Runs `effect` with a database connection scoped to this request.
 *
 * Every use case reaches SQL through here, which makes this the single seam where connection
 * lifetime lives — and the natural place to add org scoping (`set_config('app.current_org')`
 * plus RLS) when auth lands, since both want exactly one wrapper per request.
 */
export const withDatabase = <A, E, R>(
  effect: Effect.Effect<A, E, R | SqlClient.SqlClient>
): Effect.Effect<A, E | Error, Exclude<R, SqlClient.SqlClient> | Bindings | ReactivityModule.Reactivity> =>
  Effect.scoped(
    Effect.gen(function*() {
      const env = yield* Bindings
      const client = yield* PgClient.make(pgConfigFor(env.HYPERDRIVE))
      return yield* Effect.provideService(effect, SqlClient.SqlClient, client)
    })
  ) as Effect.Effect<A, E | Error, Exclude<R, SqlClient.SqlClient> | Bindings | ReactivityModule.Reactivity>
