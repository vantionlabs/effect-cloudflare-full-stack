/**
 * The transport edge for the health group.
 *
 * Handlers stay thin on purpose: decode, call the use case, return. `GetHealth` is a plain
 * function returning an Effect, so the same logic is reachable from a queue consumer, an
 * SSR loader or the eval harness without going through HTTP. That is the property that
 * makes adding a transport additive rather than a rewrite.
 */
import { ApiV1, HealthV1 } from "@ea/modules/shared/api/V1"
import { withDatabase } from "@ea/modules/shared/tables/Database"
import { Config, Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { GetHealth } from "./GetHealth.ts"

export const HealthRpc = HttpApiBuilder.group(
  ApiV1,
  "health",
  (handlers) =>
    handlers.handle("get", () =>
      Effect.gen(function*() {
        // Reaches the Worker through the bindings-backed ConfigProvider, so the same code
        // works locally and deployed.
        // orDie: a malformed VERSION is a deploy-time mistake, not a runtime condition the
        // endpoint's declared error channel should carry.
        // A Config IS an Effect in v4, so it yields directly. orDie because a malformed
        // VERSION is a deploy-time mistake, not a runtime condition the endpoint's declared
        // error channel should carry.
        const version = yield* Effect.orDie(Config.String("VERSION").pipe(Config.withDefault("dev")))
        // Connection lifetime is per request; see platform/Database.ts.
        // A connection failure is reported as degraded rather than surfacing as an
        // undeclared error: the endpoint's contract promises a HealthV1 either way, and a
        // monitor needs the body more than it needs a 500.
        return yield* withDatabase(GetHealth(version)).pipe(
          Effect.catchCause((cause) =>
            Effect.as(
              Effect.logError("Health check could not open a database connection", cause),
              new HealthV1({ status: "degraded", version, database: null })
            )
          )
        )
      }))
)
