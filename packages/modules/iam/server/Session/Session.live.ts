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
import {
  Authenticated,
  CurrentUser,
  Identity,
  type MemberRole,
  OrgId,
  UserId
} from "@ea/modules/shared/domain/Identity"
import { Effect, Layer } from "effect"
import { HttpServerRequest } from "effect/http"
import { HttpApiError } from "effect/http-api"
import { acquireAuth, authSettings } from "./Session.service.ts"

export const SessionLive = Layer.effect(Authenticated)(
  // Settings are read once, when the layer is built: the binding and secret are stable.
  Effect.map(authSettings, (config) => (httpEffect) =>
    Effect.gen(function*() {
      // The POOL is acquired inside the per-request function and released with the request
      // scope. Capturing it at layer-build time is the bug this shape prevents.
      const auth = yield* acquireAuth(config)
      const request = yield* HttpServerRequest.HttpServerRequest
      const session = yield* auth.session(new Headers(request.headers as Record<string, string>))

      if (session === null) {
        return yield* Effect.fail(new HttpApiError.Unauthorized())
      }

      // (2) above: no default organization, ever.
      const organizationId = session.activeOrganizationId
      if (organizationId === null) {
        return yield* Effect.fail(new HttpApiError.Unauthorized())
      }

      // (3): membership is re-read, and asked of better-auth rather than queried directly.
      // It owns the `member` table, so it is the authority — and keeping SqlClient out of here
      // matters because the middleware is declared in the domain package, which must not know
      // about SQL at all.
      const role = yield* auth.activeRole(
        new Headers(request.headers as Record<string, string>)
      )

      if (role === null) {
        // Authenticated, but not a member of the organization the session names: a revoked
        // membership or a stale session. Nothing to explain, just no access.
        return yield* Effect.fail(new HttpApiError.Unauthorized())
      }

      return yield* Effect.provideService(
        httpEffect,
        CurrentUser,
        new Identity({
          userId: UserId.make(session.userId),
          orgId: OrgId.make(organizationId),
          email: session.email,
          role: role as MemberRole
        })
      )
    }).pipe(Effect.scoped))
)
