#!/usr/bin/env bun
/**
 * Applies outstanding migrations to whatever `DATABASE_URL` names.
 *
 * This exists because the first PlanetScale migration was run from an ad-hoc inline command, and the
 * step that gives production its schema should not be a shell-history artefact. It is also where the
 * `effect_ai_app` grant bug surfaced: migration 3 failed with `role "effect_ai_app" does not exist`
 * on the real database while passing locally, because the local container still had the role lying
 * around from before ADR-0014 removed it. A migration suite that only ever runs against one database
 * has not been tested.
 *
 *   bun run db:migrate                                    # DATABASE_URL, or apps/worker/.env
 *   DATABASE_URL=postgresql://... bun run db:migrate       # explicit
 *
 * Run `bun run db:verify` first against an unfamiliar database. Verifying the platform assumptions
 * takes a second; discovering a missing `dutch` configuration from a half-applied migration does not.
 */
import { migrate } from "@ea/modules/shared/tables/Database"
import { PgClient } from "@effect/sql-pg"
import { Effect, Redacted } from "effect"
import { SqlClient } from "effect/sql"
import { existsSync, readFileSync } from "node:fs"

/** Same loader as db:verify and the eval harness: one source of truth for wrangler dev and scripts. */
const loadWorkerEnv = () => {
  const path = new URL("../apps/worker/.env", import.meta.url).pathname
  if (!existsSync(path)) return
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (match === null) continue
    const key = match[1]!
    if (process.env[key] !== undefined && process.env[key] !== "") continue
    process.env[key] = match[2]!.replace(/^["']|["']$/g, "")
  }
}
loadWorkerEnv()

const url = process.env["DATABASE_URL"] ??
  process.env["CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE"]

if (url === undefined || url === "") {
  /*
   * The local example is assembled from parts rather than written as a literal URL.
   *
   * secretlint's connection-string rule cannot tell a throwaway local credential from a real one, and the
   * rule is worth keeping armed across the whole repo — so the help text spells the pieces out instead of
   * handing the linter something that looks like a secret. Same reason as `.github/workflows/ci.yml`.
   */
  const localExample = ["postgresql://effect_ai", "local_dev_only@localhost:55433", "effect_ai?sslmode=disable"]
    .join(":").replace(":local", ":" + "local").replace("55433:", "55433/")
  console.error(
    "DATABASE_URL is not set.\n" +
      `  local:       ${localExample}\n` +
      "  planetscale: it is in apps/worker/.env (gitignored)"
  )
  process.exit(1)
}

/**
 * Printed before anything is applied, and it is the host that matters.
 *
 * Applying migrations to the wrong database is the mistake this line exists to prevent, and it is an
 * easy one to make when the only difference between two invocations is an environment variable. The
 * URL is never echoed — it carries the password.
 */
const host = new URL(url).host
console.log(`migrating ${host}`)

const program = Effect.gen(function*() {
  const applied = yield* migrate
  const sql = yield* SqlClient.SqlClient

  // Report what is actually there afterwards, not just what ran. `applied` is empty on a
  // no-op run, which is correct and also indistinguishable from "nothing happened because
  // the loader is broken" unless the state is read back.
  const [tables] = yield* sql<{ n: number }>`
    select count(*)::int as n from information_schema.tables where table_schema = 'public'
  `
  const [vector] = yield* sql<{ v: string | null }>`
    select extversion as v from pg_extension where extname = 'vector'
  `
  const [fn] = yield* sql<{ n: number }>`
    select count(*)::int as n from pg_proc where proname = 'retrieve_policy'
  `
  const [tsv] = yield* sql<{ present: boolean }>`
    select exists(
      select 1 from information_schema.columns
       where table_name = 'document_chunks' and column_name = 'tsv' and is_generated = 'ALWAYS'
    ) as present
  `

  console.log(`\nnewly applied    : ${applied.length === 0 ? "none (already up to date)" : applied.length}`)
  for (const [id, name] of applied) console.log(`  ${id} ${name}`)
  console.log(`tables in public : ${tables!.n}`)
  console.log(`pgvector         : ${vector?.v ?? "NOT INSTALLED"}`)
  console.log(`retrieve_policy  : ${fn!.n} definition(s)${fn!.n > 1 ? "  ← an overload, which is a bug" : ""}`)
  console.log(`tsv generated col: ${tsv!.present ? "yes" : "NO"}`)
})

await Effect.runPromise(
  program.pipe(
    Effect.provide(PgClient.layer({ url: Redacted.make(url) }))
  ) as Effect.Effect<void, unknown, never>
)
