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
 *
 * **This is also where the `Email` port meets better-auth**, and the only place it does. The senders live on
 * the request path because that is the only path that sends: identity resolution and the RPC middleware read
 * `authSettings` too, and giving them an `Email` requirement would make every authenticated request depend on
 * a service it never calls.
 */
import { Email } from "@ea/modules/shared/domain/Email"
import { Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import type { AuthEmail } from "./BetterAuth.ts"
import { acquireAuth, authSettings } from "./SessionStore.ts"

export const SessionHttp = HttpRouter.add(
  "*",
  "/api/auth/*",
  Effect.gen(function*() {
    const settings = yield* authSettings
    const email = yield* Email
    /*
     * The request's own context, so the warning below lands with the request's logger, span and annotations.
     *
     * `Effect.runPromise` would start a fresh root — correct in types, and quietly wrong in effect: the log
     * line would go to the default logger with no trace id, which is the one thing that makes it findable.
     */
    const context = yield* Effect.context<never>()
    /*
     * **Logged and swallowed, never rejected** — because better-auth is inconsistent about it, read in its source
     * at 1.7.6 rather than assumed.
     *
     * Most call sites wrap the sender in `runInBackgroundOrAwait`, which catches a rejection and logs it through
     * better-auth's own logger — so the request succeeds and the log line has no trace id. But the explicit
     * `/send-verification-email` endpoint awaits the sender bare (`api/routes/email-verification.mjs`), so there
     * a rejection IS a 500, telling an unauthenticated caller our provider is down. Swallowing here makes every
     * path behave the same, and puts the warning in our logs with the request's span.
     *
     * The cost is real and worth naming: a send that fails is invisible to the user, who waits. Consuming the
     * provider's bounce webhooks is what fixes that properly, and this repo does not do it yet.
     */
    const sendEmail = (message: AuthEmail): Promise<void> =>
      Effect.runPromiseWith(context)(
        email.send(message).pipe(
          Effect.catch((failure) =>
            // `_tag` first: a `Schema.TaggedError` is an `Error` whose `.message` is usually empty.
            Effect.logWarning(`auth email not sent: ${failure._tag}`).pipe(
              Effect.annotateLogs({ to: failure.to, reason: failure.reason, subject: message.subject })
            )
          )
        )
      )
    // Acquired per request; released with the request scope. See BetterAuth.ts.
    const auth = yield* acquireAuth({ ...settings, sendEmail })
    const request = yield* HttpServerRequest.HttpServerRequest
    const webRequest = yield* HttpServerRequest.toWeb(request)
    const webResponse = yield* Effect.promise(() => auth.handler(webRequest))
    return HttpServerResponse.fromWeb(webResponse)
  }).pipe(Effect.scoped)
)
