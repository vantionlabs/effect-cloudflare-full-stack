#!/usr/bin/env bun
/**
 * Verifies the four things this design assumes about its Postgres, against a real database.
 *
 * Every one of them was written when the only database was the local compose container. That container is
 * now pinned to `pgvector/pgvector:0.8.5-pg18` to match this script's own reading of production (18.6 /
 * pgvector 0.8.5), so the two agree — but the container's user is a superuser and a managed provider's is
 * not, which is the axis that matters:
 *
 *   1. **pgvector** — no vector column, no semantic retrieval.
 *   2. **CREATE ROLE / SET ROLE** — no longer load-bearing. RLS was removed (ADR-0014), so nothing depends
 *      on a separate app role. These two checks stay because they are what the ADR's own reasoning turned
 *      on: this script is how we learned the branch role has `createrole=true, superuser=false`, which
 *      falsified a claim that PlanetScale refuses it. Keeping them means a future "just turn RLS back on"
 *      starts from a measurement rather than a guess.
 *   3. **The `dutch` text search configuration** — real Snowball stemming is a large part of why the corpus
 *      lives in Postgres at all. Without it, hybrid retrieval loses its lexical half.
 *   4. **Generated columns calling `to_tsvector`** — `document_chunks.tsv` is generated, which requires the
 *      two-argument form to be IMMUTABLE. It is, but a provider could ship a patched catalogue.
 *
 *   bun run db:verify            # reads DATABASE_URL, or apps/worker/.env
 */
import { PgClient } from "@effect/sql-pg"
import { Effect, Redacted } from "effect"
import { SqlClient, type SqlError } from "effect/sql"
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

/*
 * `SqlError` in the callback's error channel, which it always could produce.
 *
 * This said `Effect.Effect<ReadonlyArray<A>>` — E defaulting to `never` — while every caller passes a
 * `sql` template that fails with `SqlError`. The annotation was a lie, and `Check.run` types its error
 * as `unknown` so nothing downstream noticed. It surfaced the moment scripts/ was typechecked at all:
 * TS2375 plus the language service's own TS377003 `missingEffectError`, twelve times in this file.
 */
const query = <A>(
  run: (sql: SqlClient.SqlClient) => Effect.Effect<ReadonlyArray<A>, SqlError.SqlError>
) => Effect.flatMap(SqlClient.SqlClient, run)

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
    /*
     * Named for what it REPORTS, not for what it would like to be true.
     *
     * This was called "not connecting as a superuser" and passed on `rolcreaterole || rolsuper` — so it
     * printed a green tick against `superuser=true`, asserting the opposite of what it had measured. Caught
     * on the 17→18 bump, by reading output that had been green for weeks.
     *
     * It is informational and not a gate, because since ADR-0014 nothing depends on the answer. It is worth
     * printing anyway: a superuser connection would silently bypass any RLS someone adds later, and the
     * asymmetry between this container (superuser) and PlanetScale (not) is exactly the kind of difference
     * that makes a tenancy test pass locally and mean nothing.
     */
    name: "role privileges (reported, not gated)",
    why:
      "nothing depends on this since RLS was removed (ADR-0014), but a superuser connection would silently bypass any future RLS — so which one you have is worth printing",
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
        "  survivable with a design change, and pgvector and the dutch configuration are not."
    )
    process.exit(1)
  }

  console.log("\n✓ every assumption holds. Safe to run migrations against this database.")
}

await main()
