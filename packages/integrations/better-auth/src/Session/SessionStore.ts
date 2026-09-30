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
import { type AuthConfig, makeAuth } from "./BetterAuth.ts"

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

/**
 * What a verified API key tells us: who it acts as, and in which organization.
 *
 * Deliberately not an `Identity` — the ROLE is missing, because better-auth's key plugin knows the key's owner
 * and not their membership, and inventing a role here is the mistake ADR-0022 exists to avoid. The role comes
 * from a membership lookup afterwards.
 */
export interface ApiKeyOwner {
  readonly userId: string
  readonly organizationId: string
}

export interface BetterAuthService {
  /** Handles `/api/auth/*`. Web-standard in and out, which is why it mounts cleanly. */
  readonly handler: (request: Request) => Promise<Response>
  /**
   * Verifies a presented API key, or `null`.
   *
   * **All of the hard parts are the plugin's**: the hash comparison, expiry, the `enabled` flag, the per-key rate
   * limit and its quota counters. This is the whole reason the hand-rolled version was deleted.
   *
   * The organization comes from the key's `metadata`, because the plugin is configured with
   * `references: "user"` — see `BetterAuth.ts` for why that is not `"organization"`. Metadata is
   * caller-supplied, so it is a CLAIM: what makes it safe is that the membership is checked afterwards, and a
   * key naming an organization its user does not belong to resolves to nothing.
   */
  readonly verifyApiKey: (key: string) => Effect.Effect<ApiKeyOwner | null>
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
  /*
   * Every hostname this deployment answers on, comma-separated, as host patterns.
   *
   * Empty means `BASE_URL` is the only one. Cloudflare Pages needs more than one: a preview deployment is
   * reachable at `<hash>.<project>.pages.dev` and `<branch>.<project>.pages.dev` as well as the production
   * hostname, and better-auth refuses a credentialed request from an origin it was not told about — which is
   * how this was found, as a 403 on sign-up through a deployed preview.
   *
   * Patterns must be scoped to a hostname we control. See `AuthConfig.allowedHosts`: the wildcard crosses
   * dots, so `*.pages.dev` would trust every Pages project in existence.
   */
  const allowedHosts = yield* Effect.orDie(
    Config.String("ALLOWED_HOSTS").pipe(Config.withDefault(""))
  )
  /*
   * The console's origin, when it is a DIFFERENT origin from the API.
   *
   * Empty means same-origin, which is local `vite dev` and the Pages-Function-proxy shape. In the real-world
   * deployment the API is its own subdomain — `api.example.com` serving `app.example.com` — and then this has
   * to be set, because better-auth rejects a request whose `Origin` is not trusted and that rejection is
   * correct: an untrusted origin posting credentialed requests is CSRF.
   *
   * An explicit allowlist, never a wildcard. `Access-Control-Allow-Origin: *` is invalid with credentials and
   * browsers refuse the response, so a wildcard here would not be lax — it would simply not work, after
   * looking like it should.
   */
  const consoleOrigin = yield* Effect.orDie(
    Config.String("CONSOLE_ORIGIN").pipe(Config.withDefault(""))
  )
  /*
   * The cookie's `Domain`, when the console and the API are different SUBDOMAINS of one domain.
   *
   * `.example.com` lets `app.example.com` send the session cookie to `api.example.com`, which works because
   * they are the same *site* — so `SameSite=Lax` still applies and no third-party-cookie blocking is
   * involved. That distinction is the whole reason a subdomain API is workable where a genuinely
   * cross-site one is not: `effect-ai.pages.dev` and `effect-ai.workers.dev` are different registrable
   * domains, and no `Domain` value can bridge them.
   *
   * Empty means "host-only cookie", which is correct for same-origin and is the safer default: a `Domain`
   * cookie is sent to every subdomain, so setting it wider than necessary hands the session to anything
   * hosted under the domain.
   */
  const cookieDomain = yield* Effect.orDie(
    Config.String("COOKIE_DOMAIN").pipe(Config.withDefault(""))
  )
  return {
    connectionString: store.connectionString,
    baseURL,
    allowedHosts: allowedHosts === ""
      ? undefined
      : allowedHosts.split(",").map((host) => host.trim()).filter((host) => host !== ""),
    secret: Redacted.value(secret),
    consoleOrigin: consoleOrigin === "" ? undefined : consoleOrigin,
    cookieDomain: cookieDomain === "" ? undefined : cookieDomain
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
      verifyApiKey: (key) =>
        Effect.map(
          orNull(() => auth.api.verifyApiKey({ body: { key } })),
          (result) => {
            const verified = result as {
              valid?: boolean
              key?: { referenceId?: string; metadata?: Record<string, unknown> | null } | null
            } | null
            if (verified?.valid !== true || verified.key == null) return null

            const userId = verified.key.referenceId
            const organizationId = verified.key.metadata?.["organizationId"]
            if (typeof userId !== "string" || typeof organizationId !== "string") return null
            return { userId, organizationId }
          }
        ),
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
