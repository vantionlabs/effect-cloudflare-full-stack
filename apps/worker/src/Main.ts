/**
 * Milestone 0 probe: prove @effect/sql-pg reaches Postgres through a Hyperdrive
 * binding inside real workerd, using the cloudflare:sockets Duplex adapter.
 *
 * This is deliberately NOT the composition root yet — it answers one question and
 * gets replaced by the real Main.ts in milestone 1.
 */
import { PgClient } from "@effect/sql-pg"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { pgConfigFor } from "./platform/CloudflareSocket.ts"

interface Env {
  readonly HYPERDRIVE: {
    readonly host: string
    readonly port: number
    readonly user: string
    readonly password: string
    readonly database: string
  }
}

const probe = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  const version = yield* sql<{ v: string }>`select version() as v`
  const vector = yield* sql<{ ext: string | null }>`
    select extversion as ext from pg_extension where extname = 'vector'
  `
  // The two capabilities the data-layer decision rests on.
  const stem = yield* sql<{ a: string; b: string }>`
    select to_tsvector('dutch', 'verplichting')::text  as a,
           to_tsvector('dutch', 'verplichtingen')::text as b
  `
  const hnsw = yield* sql<{ d: number }>`
    select ('[1,0,0]'::vector <=> '[0,1,0]'::vector) as d
  `

  return {
    ok: true,
    postgres: version[0]?.v.split(" ").slice(0, 2).join(" "),
    pgvector: vector[0]?.ext ?? null,
    dutchStemMatches: stem[0]?.a === stem[0]?.b,
    dutchStem: stem[0]?.a,
    cosineDistance: hnsw[0]?.d
  }
})

export default {
  async fetch(_request: Request, env: Env): Promise<Response> {
    const result = await Effect.runPromise(
      probe.pipe(
        Effect.provide(PgClient.layer(pgConfigFor(env.HYPERDRIVE))),
        Effect.catchCause((cause) => Effect.succeed({ ok: false, error: String(cause) } as const))
      )
    )
    return Response.json(result, {
      status: result.ok ? 200 : 500,
      headers: { "content-type": "application/json" }
    })
  }
}
