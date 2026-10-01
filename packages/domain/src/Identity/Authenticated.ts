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
import { HttpApiError, HttpApiMiddleware, HttpApiSecurity } from "effect/http-api"
import { RpcMiddleware } from "effect/rpc"
import { RateLimitedV1 } from "../Errors/RateLimited.ts"
import { Unauthenticated } from "../Errors/Unauthenticated.ts"
import type { CurrentUser } from "./Identity.ts"

/**
 * Requires a valid session and provides the resulting identity.
 *
 * Uses the built-in `HttpApiError.Unauthorized` (401, empty body) rather than a custom error.
 * 401 rather than 403 because the caller may retry with credentials, and an empty body because
 * distinguishing "no session" from "expired" from "unknown user" is a probing oracle while the
 * client's remedy is identical in every case.
 *
 * **One declared security scheme, not three, and the reason is the framework's dispatch.**
 *
 * `HttpApiBuilder` tries declared schemes IN ORDER and falls through to the next when a handler fails, and
 * `securityDecode` never fails — a missing header yields an empty credential. So with `apiKey` and a cookie scheme
 * declared separately, a presented-but-WRONG key would fall through and be retried as a cookie, which is exactly
 * the behaviour a test forbids: a browser with a broken key would keep working as whoever was signed in.
 *
 * Declaring one scheme removes the fall-through entirely and leaves the chain — key, bearer, cookie — in one
 * handler that controls it. The cost is that the document names only the header scheme; `Authorization: Bearer`
 * and the session cookie are described in the API's description instead. That is the honest trade: a correct
 * behaviour with a partly-prose contract beats a fully-declared contract with an authentication hole.
 */
export class Authenticated extends HttpApiMiddleware.Service<Authenticated, {
  provides: CurrentUser
  security: { readonly apiKey: HttpApiSecurity.ApiKey }
}>()("iam/Authenticated", {
  // 429 is the API-key path's quota refusal, distinct from a bad credential. See `Errors/RateLimited.ts`.
  error: [HttpApiError.Unauthorized, RateLimitedV1],
  security: { apiKey: HttpApiSecurity.apiKey({ key: "x-api-key" }) }
}) {}

export class AuthenticatedRpc extends RpcMiddleware.Service<AuthenticatedRpc, {
  provides: CurrentUser
}>()("iam/AuthenticatedRpc", { error: Unauthenticated }) {}
