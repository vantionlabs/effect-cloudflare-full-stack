/**
 * Resolves a session into `CurrentUser` — the single place authentication becomes authorisation.
 *
 * An `HttpApiMiddleware` is a *wrapping* function: it receives the downstream handler effect and
 * returns one, so it can provide services into it or fail before it runs. That is why
 * `CurrentUser` is provided here and available to every handler in an annotated group, and to
 * none outside it.
 *
 * Three refusals, each a tenancy bug avoided:
 *
 * 1. **No session → 401**, as the declared error, so endpoint signatures already account for it.
 * 2. **No active organization → 401, never a default.** Silently picking "their first org" is a
 *    classic cross-tenant leak: a user in two organizations would act in whichever the query
 *    happened to return first. If the session has not chosen, there is nothing to act in.
 * 3. **Membership is re-read, not trusted from the session.** A session can outlive a revoked
 *    membership or a demotion, and the role decides what the caller may do — so revocation should
 *    be effective immediately rather than at session expiry. It is asked of better-auth
 *    (`getActiveMemberRole`) rather than queried directly: better-auth owns the `member` table, so
 *    it is the authority, and this keeps `SqlClient` out of a middleware whose declaration lives
 *    in the domain package and must not know about SQL.
 */
import { Unauthenticated } from "@ea/modules/shared/domain/Errors"
import {
  Authenticated,
  AuthenticatedRpc,
  CurrentUser,
  Identity,
  type MemberRole,
  OrgId,
  UserId
} from "@ea/modules/shared/domain/Identity"
import { Effect, Layer } from "effect"
import { HttpServerRequest } from "effect/http"
import { HttpApiError } from "effect/http-api"
import type { AuthConfig } from "./BetterAuth.ts"
import { acquireAuth, authSettings } from "./SessionStore.ts"

/**
 * Resolves the caller's identity from request headers, or returns null.
 *
 * Takes headers rather than reaching for `HttpServerRequest`, which is what makes it genuinely
 * transport-agnostic: the RPC middleware is handed `options.headers` and never sees an HTTP request.
 * Extracted so the two middlewares below are provably **one** authorization seam rather than two
 * implementations that happen to agree today — every decision about who the caller is lives here, and
 * each layer contributes only its transport's way of refusing.
 */
const resolveIdentity = (config: AuthConfig, headers: Headers) =>
  Effect.gen(function*() {
    // The POOL is acquired inside the per-request effect and released with the request scope.
    // Capturing it at layer-build time is the bug this shape prevents — it cost two debugging
    // sessions, once for the SQL client and once for better-auth's own pool.
    const auth = yield* acquireAuth(config)

    const session = yield* auth.session(headers)
    if (session === null) return null

    // (2) above: no default organization, ever.
    const organizationId = session.activeOrganizationId
    if (organizationId === null) return null

    // (3): membership is re-read, and asked of better-auth rather than queried directly.
    const role = yield* auth.activeRole(headers)
    if (role === null) return null

    return new Identity({
      userId: UserId.make(session.userId),
      orgId: OrgId.make(organizationId),
      email: session.email,
      role: role as MemberRole
    })
  }).pipe(Effect.scoped)

export const SessionLive = Layer.effect(Authenticated)(
  // Settings are read once, when the layer is built: the binding and the secret are stable for an
  // isolate's lifetime. Only the pool is per request.
  Effect.map(authSettings, (config) => (httpEffect) =>
    Effect.gen(function*() {
      const request = yield* HttpServerRequest.HttpServerRequest
      const identity = yield* resolveIdentity(config, new Headers(request.headers as Record<string, string>))
      if (identity === null) return yield* Effect.fail(new HttpApiError.Unauthorized())
      return yield* Effect.provideService(httpEffect, CurrentUser, identity)
    }))
)

/**
 * The same seam for RPC.
 *
 * Gets its headers from the middleware options rather than from an `HttpServerRequest`, so it would
 * work unchanged over a WebSocket or a worker protocol. The refusal is a plain tagged error: RPC has
 * no status codes, and an RPC client's remedy for "not signed in" does not vary by reason.
 */
export const SessionRpcLive = Layer.effect(AuthenticatedRpc)(
  Effect.map(authSettings, (config) => (rpcEffect, options) =>
    Effect.gen(function*() {
      const identity = yield* resolveIdentity(config, new Headers(options.headers as Record<string, string>))
      if (identity === null) return yield* Effect.fail(new Unauthenticated())
      return yield* Effect.provideService(rpcEffect, CurrentUser, identity)
    }))
)
