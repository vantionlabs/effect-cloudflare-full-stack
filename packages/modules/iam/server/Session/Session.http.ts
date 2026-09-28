/**
 * Mounts better-auth's own routes at `/api/auth/*` inside the Effect router.
 *
 * better-auth speaks web-standard `Request`/`Response`, and so does a Worker, so the bridge is
 * `HttpServerRequest.toWeb` out and `HttpServerResponse.fromWeb` back. `HttpEffect.fromWebHandler`
 * would be terser, but the explicit form keeps the request in hand — which is where rate limiting
 * on sign-in and OTP endpoints will go, and that is not optional for a six-digit code.
 *
 * One Worker and one origin means no CORS layer, no trusted-origins list and no cookie domain to
 * configure — the three settings most likely to be subtly wrong. CSRF protection stays on.
 */
import { Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { acquireAuth, authSettings } from "./Session.service.ts"

export const SessionHttp = HttpRouter.add(
  "*",
  "/api/auth/*",
  Effect.gen(function*() {
    // Acquired per request; released with the request scope. See BetterAuth.ts.
    const auth = yield* acquireAuth(yield* authSettings)
    const request = yield* HttpServerRequest.HttpServerRequest
    const webRequest = yield* HttpServerRequest.toWeb(request)
    const webResponse = yield* Effect.promise(() => auth.handler(webRequest))
    return HttpServerResponse.fromWeb(webResponse)
  }).pipe(Effect.scoped)
)
