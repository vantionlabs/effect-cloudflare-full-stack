/**
 * One authorization seam, two doors.
 *
 * This replaces `SessionLive`, which implemented `Authenticated` by calling better-auth directly. The middleware
 * is a transport concern and belongs here; better-auth's job is reduced to supplying `IdentityResolver`, which is
 * the port. That inversion is what makes a second credential a composition rather than a rewrite.
 *
 * **A key is tried first.** A request carrying both is ambiguous, and an explicit `X-API-Key` is a deliberate act
 * where a cookie is ambient — a browser sends its cookie on every request whether or not the caller meant to
 * authenticate as themselves. Preferring the explicit credential also makes the surprising case debuggable: if a
 * key is present and wrong, the answer is 401 rather than silently succeeding as whoever happened to be signed
 * in.
 *
 * **Both doors produce the same `Identity`.** That is the whole design: every use case requires `CurrentUser`, so
 * a second path must satisfy that tag rather than introduce a parallel one. Two identity types would mean every
 * use case either handles both or works for one caller and not the other — and `approved_by` would have to hold
 * something synthetic.
 */
import { Connect } from "@ea/database/Database"
import { Authenticated, CurrentUser, IdentityResolver } from "@ea/domain/Identity"
import { apiKeyFrom } from "@ea/modules/iam/domain/ApiKey"
import { resolveApiKeyIdentity } from "@ea/modules/iam/use-cases/ApiKey"
import { Effect, Layer } from "effect"
import { HttpServerRequest } from "effect/http"
import { HttpApiError } from "effect/http-api"

export const AuthenticatedLive = Layer.effect(Authenticated)(
  /*
   * `Connect` is read at LAYER BUILD and provided per request, because an `HttpApiMiddleware`'s effect may not
   * carry requirements of its own. Capturing it is safe and is not the trap AGENTS.md warns about: `Connect` is
   * a factory whose `open` yields a connection per call, so what is captured here is the means of opening one,
   * not an open one. Capturing a POOL or a client at layer build is the bug, and it has cost this repo two
   * debugging sessions.
   */
  Effect.map(Effect.all([IdentityResolver, Connect]), ([resolver, connect]) => (httpEffect) =>
    Effect.gen(function*() {
      const request = yield* HttpServerRequest.HttpServerRequest
      const headers = request.headers as Record<string, string>

      /*
       * `Authorization` is accepted as well as `X-API-Key`, because both are what clients reach for. The prefix
       * check in `apiKeyFrom` is what stops a bearer JWT or a session token being hashed and looked up — a miss
       * would be indistinguishable from a wrong key, and the cheap rejection is also the clearer one.
       */
      const presented = apiKeyFrom(headers["x-api-key"] ?? headers["authorization"])

      /*
       * **A presented key does NOT fall through to the cookie**, and a test is why this is written as three
       * branches rather than `byKey ?? bySession`.
       *
       * The first version fell through, so a browser with a broken key kept working — as whoever happened to be
       * signed in. A client would have seen 200s, believed its key worked, and been writing under somebody
       * else's identity; the day the cookie was absent, everything would have broken at once for reasons
       * unrelated to the change that caused it. Presenting a credential is a claim about who you are, so a wrong
       * one is a refusal and not an invitation to guess again.
       */
      if (presented !== null) {
        const byKey = yield* Effect.provideService(resolveApiKeyIdentity(presented), Connect, connect)
        if (byKey === null) return yield* Effect.fail(new HttpApiError.Unauthorized())
        return yield* Effect.provideService(httpEffect, CurrentUser, byKey)
      }

      const bySession = yield* resolver.fromHeaders(headers)
      if (bySession === null) return yield* Effect.fail(new HttpApiError.Unauthorized())
      return yield* Effect.provideService(httpEffect, CurrentUser, bySession)
    }))
)
