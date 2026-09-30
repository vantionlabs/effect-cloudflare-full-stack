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
import { Unauthenticated } from "@ea/domain/Errors"
import {
  Authenticated,
  AuthenticatedRpc,
  CurrentUser,
  Identity,
  IdentityResolver,
  MemberRole,
  OrgId,
  UserId
} from "@ea/domain/Identity"
import { Effect, Layer, Result, Schema } from "effect"
import { HttpServerRequest } from "effect/http"
import { HttpApiError } from "effect/http-api"
import type { AuthConfig } from "./BetterAuth.ts"
import { acquireAuth, authSettings } from "./SessionStore.ts"

/**
 * Resolves the caller's identity from request headers, or returns null.
 *
 * Takes headers rather than reaching for `HttpServerRequest`, which is what makes it genuinely
 * transport-agnostic: the RPC middleware is handed `options.headers` and never sees an HTTP request.
 * Extracted so the middlewares below are provably **one** authorization seam rather than several
 * implementations that happen to agree today — every decision about who the caller is lives here, and
 * each layer contributes only its transport's way of refusing.
 *
 * **Exported for a third transport:** the WebSocket upgrade in `apps/worker/src/platform/RealtimeHttp.ts`,
 * which authenticates a socket before handing it to a room. That one is worth naming here because the room
 * cannot re-check a session afterwards — it has no database by design — so this call is the *only* moment
 * anybody verifies who is on that connection. Refusing correctly here is the whole of realtime's
 * authorization.
 */
export const resolveIdentity = (config: AuthConfig, headers: Headers) =>
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

    /*
     * The role is DECODED, not cast — and this was `role as MemberRole`, which was a hole.
     *
     * better-auth owns the `member.role` column and **its default value is `member`**, which is not in our
     * closed set (`owner`, `reviewer`, `viewer`). The cast let that string through into `Identity`, whose
     * constructor then threw — so a member added through better-auth's own invitation flow got a **500 with an
     * empty body** on every authenticated request, with nothing in the response to explain it. Invisible until
     * now because the console's own flow makes the creator an `owner`.
     *
     * An unrecognised role is treated as NO SESSION, which answers 401. Two alternatives were worse: dying (the
     * current behaviour, which reports a server fault for a membership problem) and mapping `member` onto one of
     * ours, which would be inventing an authorisation — precisely what a closed role set exists to prevent.
     *
     * The product consequence is real and is tracked: whatever invites a member must set one of OUR roles.
     */
    const decoded = Schema.decodeUnknownResult(MemberRole)(role)
    if (!Result.isSuccess(decoded)) return null

    return new Identity({
      userId: UserId.make(session.userId),
      orgId: OrgId.make(organizationId),
      email: session.email,
      role: decoded.success
    })
  }).pipe(Effect.scoped)

/**
 * The same seam as a plain service, for callers that are not handlers.
 *
 * Three layers now provide from one `resolveIdentity`: HTTP middleware, RPC middleware, and this. Each
 * contributes only its own way of refusing — a 401, a tagged error, or `null` — which is what keeps them one
 * authorization seam rather than three implementations that agree today.
 *
 * Its first consumer is the WebSocket upgrade, which needs the answer before a room accepts a socket and
 * cannot be a handler because it returns a 101 carrying a socket.
 */
export const IdentityResolverLive = Layer.effect(IdentityResolver)(
  Effect.map(authSettings, (config) => ({
    fromHeaders: (headers: Record<string, string>) =>
      /*
       * `orDie` because this port cannot fail in its signature, and that is the right shape: every failure
       * here — the database being unreachable, better-auth throwing — means we cannot say who the caller is.
       * A caller's only correct response to that is to refuse, which is what `null` already says, and a
       * typed error channel would invite treating "the database is down" as "not signed in". A defect is
       * logged with its cause and answered with a 500 by whoever is above.
       */
      Effect.orDie(resolveIdentity(config, new Headers(headers)))
  }))
)

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
