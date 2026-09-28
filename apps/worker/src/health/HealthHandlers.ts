/**
 * The transport edge for the health group.
 *
 * Handlers stay thin on purpose: decode, call the use case, return. `GetHealth` is a plain
 * function returning an Effect, so the same logic is reachable from a queue consumer, an
 * SSR loader or the eval harness without going through HTTP. That is the property that
 * makes adding a transport additive rather than a rewrite.
 */
import { ApiV1 } from "@ea/shared-domain/api"
import { Config, Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { GetHealth } from "./GetHealth.ts"

export const HealthHandlers = HttpApiBuilder.group(
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
        return yield* GetHealth(version)
      }))
)
