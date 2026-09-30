/**
 * The health use case.
 *
 * Reports the two capabilities the data-layer decision rests on, because both can fail
 * silently in ways that look like a working system:
 *
 * - **pgvector missing** → no semantic half of hybrid retrieval.
 * - **Dutch stemming missing** → "verplichting" stops matching "verplichtingen", retrieval
 *   misses clauses, and rail 1 converts every miss into `needs_human`. The queue fills and
 *   the product looks finished while being useless (risk R1).
 *
 * Stemming is proven by asking Postgres whether the two forms stem alike, not by reading
 * `pg_ts_config` — a config row says the dictionary is installed, not that it works.
 */
import { DatabaseHealth, HealthReport } from "@ea/modules/shared/domain/Health"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export const GetHealth = (version: string) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient

    const rows = yield* sql<{
      pg: string
      vector: string | null
      stem_a: string
      stem_b: string
    }>`
      select
        current_setting('server_version')                       as pg,
        (select extversion from pg_extension where extname = 'vector') as vector,
        to_tsvector('dutch', 'verplichting')::text              as stem_a,
        to_tsvector('dutch', 'verplichtingen')::text            as stem_b
    `

    const row = rows[0]
    if (row === undefined) {
      return new HealthReport({ status: "degraded", version, database: null })
    }

    const database = new DatabaseHealth({
      postgresVersion: row.pg,
      pgvectorVersion: row.vector,
      dutchStemming: row.stem_a === row.stem_b
    })

    // Reachable but missing a retrieval capability is degraded, not ok: the pipeline would
    // run and quietly escalate everything.
    const healthy = database.pgvectorVersion !== null && database.dutchStemming

    return new HealthReport({ status: healthy ? "ok" : "degraded", version, database })
  }).pipe(
    // A database that cannot be reached is a degraded service, not a 500: the endpoint's
    // job is to report, and a monitor needs the body rather than a stack trace.
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.logError("Health check could not reach the database", cause),
        new HealthReport({ status: "degraded", version, database: null })
      )
    )
  )
