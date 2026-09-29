/**
 * The authentication contract, in both transports.
 *
 * In `shared/domain` rather than the `iam` slice, and paired with `Identity.model.ts` on purpose: it
 * is the declaration that *provides* `CurrentUser`, so every protected group in every slice needs it.
 * Putting it in `iam/domain` would make `@ea/modules/intake/domain` depend on
 * `@ea/modules/iam/domain` just to mark an endpoint authenticated — a cross-slice dependency for a
 * cross-slice contract. Only the declaration is here; the implementation is the iam slice's
 * (`@ea/modules/iam/server`).
 *
 * Whether an endpoint requires a session is part of the contract a client compiles against, not a
 * server implementation detail — which is why this sits beside the `HttpApi` and `RpcGroup`
 * declarations rather than with the handlers.
 *
 * `provides: CurrentUser` is the load-bearing part. A handler on an annotated endpoint has
 * `CurrentUser` available; one without the annotation does not — so reaching for the current
 * user in an unauthenticated handler is a type error rather than a runtime `undefined`. And
 * because every store method requires `CurrentUser` too, an unauthenticated endpoint *cannot
 * compile* against a tenant-scoped query.
 */
import { HttpApiError, HttpApiMiddleware } from "effect/http-api"
import { RpcMiddleware } from "effect/rpc"
import { Unauthenticated } from "../Errors/Unauthenticated.ts"
import type { CurrentUser } from "./Identity.ts"

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

export class AuthenticatedRpc extends RpcMiddleware.Service<AuthenticatedRpc, {
  provides: CurrentUser
}>()("iam/AuthenticatedRpc", { error: Unauthenticated }) {}
