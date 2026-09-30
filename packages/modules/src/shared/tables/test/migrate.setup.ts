/**
 * Applies migrations once, before any test in the `tables` project runs.
 *
 * Exists because of a flake that is worth naming: the tenancy suite happened to call `migrate`, and every
 * other database test silently depended on that having run first. Add a test file that sorts earlier and
 * it fails with `SqlSyntaxError` on a table that does not exist yet — which reads like a bug in the query
 * rather than a missing migration, and cost a round of debugging to see through.
 *
 * A global setup makes the dependency explicit and removes the ordering entirely.
 */
import { migrate } from "@ea/modules/shared/tables/Migrations"
import { PgClient } from "@effect/sql-pg"
import { Effect, Redacted } from "effect"

const Pg = PgClient.layer({
  host: process.env["PGHOST"] ?? "localhost",
  port: Number(process.env["PGPORT"] ?? 55433),
  username: process.env["PGUSER"] ?? "effect_ai",
  password: Redacted.make(process.env["PGPASSWORD"] ?? "local_dev_only"),
  database: process.env["PGDATABASE"] ?? "effect_ai",
  ssl: false
})

export default async function setup() {
  await Effect.runPromise(
    migrate.pipe(Effect.provide(Pg)) as Effect.Effect<unknown, unknown, never>
  )
}
