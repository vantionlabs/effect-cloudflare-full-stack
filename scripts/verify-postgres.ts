#!/usr/bin/env bun
/**
 * Verifies the five things this design assumes about its Postgres, against a real database.
 *
 * Every one of them has only ever been tested against the local compose container, which is a
 * `pgvector/pgvector:pg17` image where the connecting user is a superuser. A managed provider is a different
 * situation on exactly the axes that matter here, and two of these assumptions are load-bearing:
 *
 *   1. **pgvector** — no vector column, no semantic retrieval.
 *   2. **CREATE ROLE** — the whole tenancy model is `set local role effect_ai_app` plus RLS. Without the role,
 *      a superuser connection bypasses every policy and the app-layer predicate is all that separates
 *      tenants. This is the one most likely to be refused by a managed provider, and the most expensive to
 *      discover late.
 *   3. **SET ROLE** — creating the role is not enough; the connecting user must be able to become it.
 *   4. **The `dutch` text search configuration** — real Snowball stemming is a large part of why the corpus
 *      lives in Postgres at all. Without it, hybrid retrieval loses its lexical half.
 *   5. **Generated columns calling `to_tsvector`** — `document_chunks.tsv` is generated, which requires the
 *      two-argument form to be IMMUTABLE. It is, but a provider could ship a patched catalogue.
 *
 *   bun run db:verify            # reads DATABASE_URL, or apps/worker/.env
 */
import { PgClient } from "@effect/sql-pg"
import { Effect, Redacted } from "effect"
import { SqlClient } from "effect/sql"
import { existsSync, readFileSync } from "node:fs"

/** Same loader as the eval harness: one source of truth for wrangler dev and for scripts. */
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
  console.error(
    "no DATABASE_URL.\n\n" +
      "Put PlanetScale's DIRECT connection string in apps/worker/.env as DATABASE_URL (Cloudflare\n" +
      "recommends the direct string over a provider's pooled one for Hyperdrive), or pass it inline:\n\n" +
      "  DATABASE_URL='postgres://…' bun run db:verify"
  )
  process.exit(1)
}

const Pg = PgClient.layer({ url: Redacted.make(url) })

interface Check {
  readonly name: string
  readonly why: string
  readonly run: Effect.Effect<{ readonly ok: boolean; readonly detail: string }, unknown, SqlClient.SqlClient>
}

const query = <A>(run: (sql: SqlClient.SqlClient) => Effect.Effect<ReadonlyArray<A>>) =>
  Effect.flatMap(SqlClient.SqlClient, run)

const checks: ReadonlyArray<Check> = [
  {
    name: "server version",
    why: "generated columns need 12+, and the migrations assume modern defaults",
    run: query<{ version: string }>((sql) => sql`select version() as version`).pipe(
      Effect.map((rows) => ({ ok: true, detail: rows[0]!.version.split(" ").slice(0, 2).join(" ") }))
    )
  },
  {
    name: "pgvector available",
    why: "no vector column means no semantic half of retrieval",
    run: query<{ name: string; installed: string | null }>((sql) =>
      sql`
        select name, installed_version as installed from pg_available_extensions where name = 'vector'
      `
    ).pipe(
      Effect.map((rows) => ({
        ok: rows.length > 0,
        detail: rows.length === 0
          ? "NOT AVAILABLE"
          : `available${rows[0]!.installed === null ? " (not yet installed)" : `, installed ${rows[0]!.installed}`}`
      }))
    )
  },
  {
    name: "not connecting as a superuser",
    why:
      "not fatal since RLS was removed (ADR-0014), but a superuser connection means any future RLS would be silently bypassed — and it is worth knowing which you have",
    run: query<{ rolcreaterole: boolean; rolsuper: boolean; usr: string }>((sql) =>
      sql`
        select rolcreaterole, rolsuper, current_user as usr from pg_roles where rolname = current_user
      `
    ).pipe(
      Effect.map((rows) => {
        const row = rows[0]!
        return {
          ok: row.rolcreaterole || row.rolsuper,
          detail: `connecting as ${row.usr} (createrole=${row.rolcreaterole}, superuser=${row.rolsuper})`
        }
      })
    )
  },
  {
    name: "the dutch text search configuration exists",
    why:
      "real Snowball stemming is a large part of why the corpus lives in Postgres; without it the lexical half is crippled",
    run: query<{ present: boolean }>((sql) =>
      sql`select exists(select 1 from pg_ts_config where cfgname = 'dutch') as present`
    ).pipe(
      Effect.map((rows) => ({
        ok: rows[0]!.present,
        detail: rows[0]!.present ? "present" : "MISSING"
      }))
    )
  },
  {
    name: "dutch stemming actually stems",
    why: "a present configuration that does not stem would pass a catalogue check and fail retrieval",
    run: query<{ stems: boolean }>((sql) =>
      sql`
        select to_tsvector('dutch', 'goedkeuringen') @@ websearch_to_tsquery('dutch', 'goedkeuring') as stems
      `
    ).pipe(
      Effect.map((rows) => ({
        ok: rows[0]!.stems,
        detail: rows[0]!.stems ? "singular query matches plural text" : "DOES NOT STEM"
      }))
    )
  },
  {
    name: "to_tsvector is immutable enough for a generated column",
    why: "document_chunks.tsv is GENERATED, which requires the two-argument form to be IMMUTABLE",
    run: query<{ volatile: string }>((sql) =>
      sql`
        select provolatile as volatile from pg_proc
         where proname = 'to_tsvector'
           and pronargs = 2
         limit 1
      `
    ).pipe(
      Effect.map((rows) => ({
        ok: rows.length > 0 && rows[0]!.volatile === "i",
        detail: rows.length === 0 ? "not found" : `provolatile=${rows[0]!.volatile} (i = immutable)`
      }))
    )
  }
]

const main = async () => {
  console.log("verifying the platform assumptions this design rests on\n")

  let failed = 0
  for (const check of checks) {
    const result = await Effect.runPromise(
      check.run.pipe(
        Effect.provide(Pg),
        Effect.catchCause((cause) =>
          Effect.succeed({ ok: false, detail: `query failed: ${String(cause).split("\n")[0]}` })
        )
      ) as Effect.Effect<{ ok: boolean; detail: string }, never, never>
    )
    console.log(`${result.ok ? "✓" : "✗"} ${check.name.padEnd(46)} ${result.detail}`)
    if (!result.ok) {
      console.log(`  ↳ ${check.why}`)
      failed++
    }
  }

  if (failed > 0) {
    console.error(
      `\n✗ ${failed} assumption(s) do not hold. Do NOT migrate yet — read each one above: some are\n` +
        "  survivable with a design change, and the role one is not."
    )
    process.exit(1)
  }

  console.log("\n✓ every assumption holds. Safe to run migrations against this database.")
}

await main()
