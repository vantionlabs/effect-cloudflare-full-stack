/**
 * One authorization seam, two credentials — and the only file allowed to name both halves.
 *
 * **Why this lives in the composition root and not in `packages/api`.** It needs a vendor (better-auth verifies
 * the key) and a feature (`IdentityForMember` checks the membership), and `dep:check` forbids either from naming
 * the other: the api package may not name an integration, and an integration may not reach a `use-cases` ring.
 * Both rules are right, and their intersection is exactly this file's job — composition. It sat in
 * `packages/api/src/v1/Identity/` until the API-key work made it import better-auth, at which point the check
 * said so.
 *
 * **A key is tried first.** A request carrying both is ambiguous, and an explicit key is a deliberate act where
 * a cookie is ambient — a browser sends its cookie whether or not the caller meant to authenticate as
 * themselves.
 *
 * **A presented key does NOT fall through to the cookie.** Written as three branches for that reason, and a test
 * is why: the first version fell through, so a browser with a broken key kept working *as whoever was signed in*.
 * A client would have seen 200s, believed its key worked, and been writing under somebody else's identity.
 * Presenting a credential is a claim about who you are, so a wrong one is a refusal.
 *
 * **Both credentials produce the same `Identity`.** Every use case requires `CurrentUser`, so a second path has
 * to satisfy that tag rather than introduce a parallel one (ADR-0022).
 */
import { apiKeyOwner, authSettings } from "@ea/better-auth/Session"
import { Connect, withDatabase } from "@ea/database/Database"
import { RateLimited, retryAfterSeconds } from "@ea/domain/Errors"
import { Authenticated, CurrentUser, IdentityResolver } from "@ea/domain/Identity"
import { IdentityForMember } from "@ea/modules/iam/use-cases/Identity"
import { Effect, Layer, Redacted } from "effect"
import { HttpServerRequest } from "effect/http"
import { HttpApiError } from "effect/http-api"

/**
 * The headers a key may arrive in.
 *
 * Both, because both are what clients reach for and neither is more correct. The `ea_` prefix is what makes a
 * session token or a JWT presented here fail fast rather than being verified and missing — a miss would be
 * indistinguishable from a wrong key, so the cheap rejection is also the clearer one.
 */
const presentedKey = (headers: Record<string, string>): string | null => {
  const raw = headers["x-api-key"] ?? headers["authorization"]
  if (raw === undefined) return null
  const value = raw.startsWith("Bearer ") ? raw.slice("Bearer ".length).trim() : raw.trim()
  return value.startsWith("ea_") && value.length > 24 ? value : null
}

export const AuthenticatedLive = Layer.effect(Authenticated)(
  /*
   * `Connect` and the auth settings are read at LAYER BUILD, because an `HttpApiMiddleware`'s effect may not
   * carry requirements of its own. Safe, and not the trap AGENTS.md warns about: `Connect` is a factory whose
   * `open` yields a connection per call, so what is captured is the means of opening one rather than an open one.
   */
  Effect.map(
    Effect.all([IdentityResolver, Connect, authSettings]),
    ([resolver, connect, config]) => ({
      /*
       * Keyed by the ONE declared security scheme. The `credential` is the `x-api-key` header, or empty when
       * absent — `securityDecode` does not fail. Headers are read directly as well, because `Authorization:
       * Bearer` is accepted too and is not part of the declared scheme (see `Authenticated`).
       */
      apiKey: (httpEffect, { credential }) =>
        Effect.gen(function*() {
          const request = yield* HttpServerRequest.HttpServerRequest
          const headers = request.headers as Record<string, string>
          const fromScheme = Redacted.value(credential)
          const key = presentedKey(fromScheme === "" ? headers : { "x-api-key": fromScheme })

          if (key !== null) {
            /*
             * Two steps, and both are necessary. better-auth verifies the key — hash, expiry, `enabled`, the
             * per-key rate limit — and tells us who owns it and which organization it CLAIMS. The membership
             * lookup is what turns that claim into a fact: the organization lives in caller-supplied metadata, so
             * a key naming an organization its user does not belong to resolves to nothing.
             */
            const owner = yield* apiKeyOwner(config, key, new Headers(headers))
            // Before the membership lookup: an over-quota key spends no database round trip.
            if (owner?._tag === "RateLimited") {
              return yield* new RateLimited({ retryAfterSeconds: retryAfterSeconds(owner.tryAgainInMs) })
            }
            const identity = owner === null
              ? null
              : yield* Effect.orElseSucceed(
                Effect.provideService(withDatabase(IdentityForMember(owner)), Connect, connect),
                () => null
              )

            if (identity === null) return yield* new HttpApiError.Unauthorized()
            return yield* Effect.provideService(httpEffect, CurrentUser, identity)
          }

          const bySession = yield* resolver.fromHeaders(headers)
          if (bySession === null) return yield* new HttpApiError.Unauthorized()
          return yield* Effect.provideService(httpEffect, CurrentUser, bySession)
        })
    })
  )
)
