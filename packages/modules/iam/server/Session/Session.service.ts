/**
 * better-auth, acquired per request.
 *
 * **This is deliberately NOT a memoised service.** better-auth holds a `pg` Pool, and a TCP
 * socket cannot outlive the request that opened it on Workers — so an instance built once per
 * isolate works for the first request, then hangs the Worker ("detected that your Worker's code
 * had hung"). That is the same failure the `PgClient` had, and it was reintroduced here by
 * putting `BetterAuthLive` in the app layer while the docstring claimed per-request. Hence
 * `acquireAuth`: an Effect that builds an instance in the *caller's* scope, so it cannot be
 * memoised by accident.
 *
 * Hyperdrive keeps the real pool warm outside the Worker, so this costs a handshake rather than
 * a connection. `max: 1` for the same reason, and because a larger pool would only consume more
 * of Workers' six simultaneous outgoing connections.
 *
 * The port stays deliberately narrower than better-auth's surface — a request handler, a session
 * lookup, a role lookup — so the `iam` use cases remain testable against a fake and swapping auth
 * libraries touches this file rather than every handler.
 */
import { Config, Context, Effect, Redacted, type Scope } from "effect"
import { type AuthConfig, makeAuth } from "./Session.betterauth.ts"

/**
 * Where better-auth keeps sessions, members and organizations.
 *
 * A connection string rather than the Worker's whole `Env`: this slice has no business being able
 * to reach the document bucket or the queue, and a narrow requirement is also what lets a Node
 * test or the eval harness point it at a local Postgres.
 */
export class SessionStore extends Context.Service<SessionStore, {
  readonly connectionString: string
}>()("iam/SessionStore") {}

/**
 * Treats any better-auth failure as "no session" rather than propagating it.
 *
 * An unreachable session store must produce a 401, not a 500: a 500 tells an attacker the
 * difference between a bad token and a broken database.
 */
const orNull = <A>(promise: () => Promise<A>): Effect.Effect<A | null> =>
  Effect.orElseSucceed(Effect.tryPromise(promise), () => null)

/** The session shape the application depends on. Narrower than better-auth's on purpose. */
interface ResolvedSession {
  readonly userId: string
  readonly email: string
  /** better-auth's active organization for this session, when the user has selected one. */
  readonly activeOrganizationId: string | null
}

export interface BetterAuthService {
  /** Handles `/api/auth/*`. Web-standard in and out, which is why it mounts cleanly. */
  readonly handler: (request: Request) => Promise<Response>
  /** Resolves the session from request headers, or `null` when there is none. */
  readonly session: (headers: Headers) => Effect.Effect<ResolvedSession | null>
  /**
   * The caller's role in their active organization, or `null` if they are not a member.
   *
   * Asked of better-auth rather than queried directly: it owns the `member` table, so it is the
   * authority on membership, and routing through it keeps `SqlClient` out of the middleware —
   * which would otherwise have to appear in the domain package's middleware declaration.
   */
  readonly activeRole: (headers: Headers) => Effect.Effect<string | null>
}

/**
 * Reads the settings better-auth needs. Safe to do once when a layer is built: the Hyperdrive
 * binding and the secret are stable for an isolate's lifetime. Only the *pool* is per-request.
 */
export const authSettings: Effect.Effect<AuthConfig, never, SessionStore> = Effect.gen(function*() {
  const store = yield* SessionStore
  // orDie: a missing or too-short secret is a deployment mistake, not a runtime condition an
  // endpoint's error channel should carry. better-auth warns below 32 characters.
  const secret = yield* Effect.orDie(Config.Redacted("BETTER_AUTH_SECRET"))
  const baseURL = yield* Effect.orDie(
    Config.String("BASE_URL").pipe(Config.withDefault("http://localhost:8799"))
  )
  return {
    connectionString: store.connectionString,
    baseURL,
    secret: Redacted.value(secret)
  }
})

/**
 * Builds a better-auth instance in the caller's scope.
 *
 * Requires `Scope`, which is what stops this being lifted into a memoised layer: a layer built
 * once per isolate has no per-request scope to attach to. Takes settings rather than reading
 * `Bindings`, so it can be called from inside an `HttpApiMiddleware` — whose own requirements are
 * fixed by the contract in the domain package and cannot include a Worker-specific service.
 */
export const acquireAuth = (
  config: AuthConfig
): Effect.Effect<BetterAuthService, never, Scope.Scope> =>
  Effect.gen(function*() {
    const auth = yield* Effect.acquireRelease(
      Effect.sync(() => makeAuth(config)),
      // Close the pool with the request. Without this the isolate accumulates pools until it is
      // evicted, and on Workers that shows up as connection exhaustion rather than memory growth.
      (instance) => Effect.promise(() => (instance.options.database as { end: () => Promise<void> }).end())
    )

    return {
      handler: (request) => auth.handler(request),
      activeRole: (headers) =>
        Effect.map(
          orNull(() => auth.api.getActiveMemberRole({ headers })),
          (result) => (result as { role?: string } | null)?.role ?? null
        ),
      session: (headers) =>
        Effect.map(
          orNull(() => auth.api.getSession({ headers })),
          (result) => {
            const session = result as
              | { user?: { id: string; email: string }; session?: { activeOrganizationId?: string | null } }
              | null
            if (session?.user === undefined) return null
            return {
              userId: session.user.id,
              email: session.user.email,
              activeOrganizationId: session.session?.activeOrganizationId ?? null
            }
          }
        )
    } satisfies BetterAuthService
  })
