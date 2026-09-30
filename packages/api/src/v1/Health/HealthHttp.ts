/**
 * The transport edge for the health group.
 *
 * Handlers stay thin on purpose: decode, call the use case, return. `GetHealth` is a plain
 * function returning an Effect, so the same logic is reachable from a queue consumer, an
 * SSR loader or the eval harness without going through HTTP. That is the property that
 * makes adding a transport additive rather than a rewrite.
 */
import { withDatabase } from "@ea/database/Database"
import { GetHealth } from "@ea/modules/shared/use-cases/Health"
import { Config, Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { ApiV1 } from "../ApiV1.ts"
import { DatabaseHealthV1, HealthV1 } from "./HealthWire.ts"

export const HealthHttp = HttpApiBuilder.group(
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
        /*
         * The domain report, mapped to the frozen v1 shape HERE.
         *
         * That mapping is the whole reason this file exists separately from the use case: `postgres_version` and
         * its snake_case siblings are promises to callers we do not control (ADR-0012), while `GetHealth` gathers
         * facts and should be free to be renamed. The use case used to return the wire type directly, which meant
         * it could only live in `apps/worker` — `packages/modules` may not import `@ea/api`.
         */
        const report = yield* withDatabase(GetHealth(version)).pipe(
          Effect.catchCause((cause) =>
            Effect.as(
              Effect.logError("Health check could not open a database connection", cause),
              // The domain type, not the wire one: one mapping, below, for every path out of here.
              { status: "degraded" as const, version, database: null }
            )
          )
        )

        return new HealthV1({
          status: report.status,
          version: report.version,
          database: report.database === null ? null : new DatabaseHealthV1({
            postgres_version: report.database.postgresVersion,
            pgvector_version: report.database.pgvectorVersion,
            dutch_stemming: report.database.dutchStemming
          })
        })
      }))
)
