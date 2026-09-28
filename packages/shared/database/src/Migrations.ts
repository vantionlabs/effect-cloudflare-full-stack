/**
 * The migration set, and the one place that decides ordering.
 *
 * `Migrator.fromRecord` keys are `<id>_<name>`, parsed into ordered migrations. Listing them
 * explicitly rather than globbing is deliberate: a glob makes ordering depend on filesystem
 * iteration, and a migration that runs out of order against a real database is not recoverable
 * by re-running it.
 *
 * `0003_auth` is generated from the installed better-auth by `bun scripts/auth-schema.ts`, not
 * by @better-auth/cli (which lags the library by three minors). The Migrator stays authoritative
 * for **every** table including better-auth's — one migration system, one database — so
 * `better-auth migrate` is never run (plan risk R9).
 */
import { Migrator } from "effect/sql"
import tenancy from "./migrations/0001_tenancy.ts"
import sourceDocuments from "./migrations/0002_intake.ts"
import auth from "./migrations/0003_auth.ts"
import intakes from "./migrations/0004_intake.ts"

export const migrations = {
  "0001_tenancy": tenancy,
  "0002_intake": sourceDocuments,
  // Generated from the installed better-auth by `bun scripts/auth-schema.ts`.
  "0003_auth": auth,
  "0004_intake": intakes
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
