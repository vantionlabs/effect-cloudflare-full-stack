/**
 * The migration set, and the one place that decides ordering.
 *
 * Cross-slice by nature, which is why it sits in `shared/tables` and imports each slice's own
 * `*.table.ts`: the tables belong to their slices, but the *order* they run in is global and there
 * can only be one answer to it. Listing them explicitly rather than globbing is deliberate — a glob
 * makes ordering depend on filesystem iteration, and a migration that runs out of order against a
 * real database is not recoverable by re-running it.
 *
 * The keys are `<id>_<name>` and are **permanent**: they are what `effect_sql_migrations` records,
 * so renaming one re-runs it. That is why `0002_intake` still names the documents table.
 *
 * `0003_auth` is generated from the installed better-auth by `bun scripts/auth-schema.ts`, not by
 * @better-auth/cli (which lags the library by three minors). The Migrator stays authoritative for
 * **every** table including better-auth's — one migration system, one database — so
 * `better-auth migrate` is never run (plan risk R9).
 */
import { ExtractionTable } from "@ea/modules/decision/tables/Extraction"
import { SessionTable } from "@ea/modules/iam/tables/Session"
import { DocumentTable } from "@ea/modules/intake/tables/Document"
import { IntakeTable } from "@ea/modules/intake/tables/Intake"
import { ChunkTable } from "@ea/modules/policy/tables/Chunk"
import { RetrievalTable } from "@ea/modules/policy/tables/Retrieval"
import { Migrator } from "effect/sql"
import { TenancyTable } from "../Tenancy/Tenancy.table.ts"

export const migrations = {
  "0001_tenancy": TenancyTable,
  "0002_intake": DocumentTable,
  // Generated from the installed better-auth by `bun scripts/auth-schema.ts`.
  "0003_auth": SessionTable,
  "0004_intake": IntakeTable,
  "0005_extraction": ExtractionTable,
  "0006_policy": ChunkTable,
  // The retrieval function is its own migration: it is replaced whenever the fusion changes,
  // and keeping it separate means that change is one reviewable diff rather than a table edit.
  "0007_retrieval": RetrievalTable
}

export const loader = Migrator.fromRecord(migrations)

/**
 * Applies any outstanding migrations. Safe to run repeatedly; each is recorded once in
 * `effect_sql_migrations`.
 *
 * `Migrator.make` is curried: the first call configures schema dumping (skipped — a Worker has no
 * filesystem to dump to), the second takes the loader.
 */
export const migrate = Migrator.make({})({ loader })
