/**
 * How a connection is obtained, as a port — and why its type says `Scope`.
 *
 * **A TCP socket opened during one request cannot be reused in another on Workers.** Outbound
 * connections are tied to the request's I/O context. Memoising a client for the isolate's lifetime
 * — to keep its prepared-statement cache — therefore fails in a way that is easy to miss: the first
 * request succeeds, the second returns a degraded result, and the third **hangs the Worker**. A
 * single manual request will not reveal it; three consecutive ones will. It happened twice here,
 * once for the SQL client and once for better-auth's pool.
 *
 * So `open` requires a `Scope`. That is not decoration: it makes "this connection outlives nothing"
 * a fact the compiler checks, and it is the reason this port exists instead of a `SqlClient` layer.
 *
 * The cost is the prepared-statement cache, which is precisely the work Hyperdrive does on our
 * behalf — it keeps the pool warm *outside* the Worker, so a connection per request costs a p90
 * 4 ms handshake rather than a round trip to the origin region.
 */
import { Context, Effect, type Scope } from "effect"
import { SqlClient, type SqlError } from "effect/sql"

export interface ConnectService {
  readonly open: Effect.Effect<SqlClient.SqlClient, SqlError.SqlError, Scope.Scope>
}

export class Connect extends Context.Service<Connect, ConnectService>()("tables/Connect") {}

/**
 * Runs `effect` with a connection scoped to the current unit of work.
 *
 * Every request handler and every queue consumer wraps its work in exactly one of these, which
 * makes this the single place connection lifetime is decided.
 */
export const withDatabase = <A, E, R>(
  effect: Effect.Effect<A, E, R | SqlClient.SqlClient>
): Effect.Effect<A, E | SqlError.SqlError, Exclude<R, SqlClient.SqlClient> | Connect> =>
  Effect.scoped(
    Effect.gen(function*() {
      const connect = yield* Connect
      const sql = yield* connect.open
      return yield* Effect.provideService(effect, SqlClient.SqlClient, sql)
    })
  ) as Effect.Effect<A, E | SqlError.SqlError, Exclude<R, SqlClient.SqlClient> | Connect>
