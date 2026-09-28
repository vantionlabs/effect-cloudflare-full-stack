/**
 * The authentication middleware.
 *
 * In `shared/domain` rather than the `iam` slice, and paired with `Identity.model.ts` on purpose:
 * it is the declaration that *provides* `CurrentUser`, so every protected group in every slice
 * needs it. Putting it in `iam/domain` would make `@ea/intake-domain` depend on `@ea/iam-domain`
 * just to mark an endpoint authenticated — a cross-slice dependency for a cross-slice contract.
 *
 * The IMPLEMENTATION is the iam slice's (`@ea/iam-server`). Only the contract is here *declaration*.
 *
 * It lives in the domain package alongside the `HttpApi` contract, because whether an endpoint
 * requires a session is part of the contract a client compiles against — not a server
 * implementation detail. The implementation (`AuthenticatedLive`) stays in the Worker.
 *
 * `provides: CurrentUser` is the load-bearing part. A handler on an annotated endpoint has
 * `CurrentUser` available; one without the annotation does not — so reaching for the current
 * user in an unauthenticated handler is a type error rather than a runtime `undefined`. And
 * because every store method requires `CurrentUser` too, an unauthenticated endpoint *cannot
 * compile* against a tenant-scoped query.
 */
import { HttpApiError, HttpApiMiddleware } from "effect/http-api"
import type { CurrentUser } from "./Identity.model.ts"

/**
 * Requires a valid session and provides the resulting identity.
 *
 * Uses the built-in `HttpApiError.Unauthorized` (401, empty body) rather than a custom error.
 * 401 rather than 403 because the caller may retry with credentials, and an empty body because
 * distinguishing "no session" from "expired" from "unknown user" is a probing oracle while the
 * client's remedy is identical in every case.
 */
export class Authenticated extends HttpApiMiddleware.Service<Authenticated, {
  provides: CurrentUser
}>()("iam/Authenticated", { error: HttpApiError.Unauthorized }) {}
