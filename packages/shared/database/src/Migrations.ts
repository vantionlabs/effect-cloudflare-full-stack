/**
 * The migration set, and the one place that decides ordering.
 *
 * `Migrator.fromRecord` keys are `<id>_<name>`, parsed into ordered migrations. Listing them
 * explicitly rather than globbing is deliberate: a glob makes ordering depend on filesystem
 * iteration, and a migration that runs out of order against a real database is not recoverable
 * by re-running it.
 *
 * better-auth's generated schema is pasted in as `0003_auth` at build-order step 3. The Migrator
 * stays authoritative for **every** table including better-auth's — one migration system, one
 * database — so `better-auth migrate` is never run (plan risk R9).
 */
import { Migrator } from "effect/sql"
import tenancy from "./migrations/0001_tenancy.ts"
import intake from "./migrations/0002_intake.ts"

export const migrations = {
  "0001_tenancy": tenancy,
  "0002_intake": intake
}

export const loader = Migrator.fromRecord(migrations)

/**
 * Applies any outstanding migrations. Safe to run repeatedly; each is recorded once in
 * `effect_sql_migrations`.
 *
 * `Migrator.make` is curried: the first call configures schema dumping (skipped — a Worker has
 * no filesystem to dump to), the second takes the loader.
 */
export const migrate = Migrator.make({})({ loader })
