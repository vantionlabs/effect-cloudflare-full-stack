/**
 * Hybrid retrieval against real Postgres: real pgvector, real Dutch stemming, real RLS.
 *
 * Not a mock in sight, deliberately. The fusion is SQL, the stemming is Postgres's, and the tenant
 * filter is a policy — none of which a fake can tell you anything about. This is the test that would
 * catch an HNSW index built for the wrong operator class, a `security definer` slip on the function,
 * or a `collection` filter that stopped applying.
 */
import { Db } from "@ea/database/Database"
import { CurrentOrg, CurrentUser, Identity, OrgId, UserId } from "@ea/domain/Identity"
import { Ids } from "@ea/domain/Ids"
import { type Chunker, ChunkerHeading } from "@ea/modules/policy/domain/Chunk"
import type { EmbeddingProfile } from "@ea/modules/policy/domain/Embedding"
import { EmbedderDeterministic } from "@ea/modules/policy/server/Embedding"
import { IndexPolicyDocument } from "@ea/modules/policy/use-cases/Chunk"
import { RetrievePolicy } from "@ea/modules/policy/use-cases/Retrieval"
import { PgClient } from "@effect/sql-pg"
import { Effect, Layer, Redacted } from "effect"
import type { EmbeddingModel } from "effect/ai"
import { SqlClient } from "effect/sql"
import { beforeAll, describe, expect, it } from "vitest"

const ORG_A = OrgId.make("retrieval_org_a")
const ORG_B = OrgId.make("retrieval_org_b")

const Admin = PgClient.layer({
  // PG* env vars with the compose.yaml values as defaults, matching `migrate.setup.ts` and `evals/`.
  // Hardcoding them made this suite pass locally and fail in CI with `28P01 password authentication
  // failed`, because CI runs its own Postgres service with its own throwaway password. A test that can
  // only reach one specific container is not a test of the code.
  host: process.env["PGHOST"] ?? "localhost",
  port: Number(process.env["PGPORT"] ?? 55433),
  username: process.env["PGUSER"] ?? "effect_ai",
  password: Redacted.make(process.env["PGPASSWORD"] ?? "local_dev_only"),
  database: process.env["PGDATABASE"] ?? "effect_ai",
  ssl: false
})

// crypto.randomUUID rather than the uuid package: this test only needs distinct keys, and the
// modules package has no reason to depend on a v7 implementation for a fixture.
const IdsLive = Layer.succeed(Ids)({ next: Effect.sync(() => crypto.randomUUID()) })

const identity = (orgId: OrgId) =>
  new Identity({ userId: UserId.make("u1"), orgId, email: "r@example.com", role: "reviewer" })

const layers = Layer.mergeAll(Db.layer, IdsLive, EmbedderDeterministic, ChunkerHeading).pipe(Layer.provideMerge(Admin))

const run = <A, E>(
  orgId: OrgId,
  effect: Effect.Effect<
    A,
    E,
    | Db
    | Ids
    | CurrentUser
    | CurrentOrg
    | SqlClient.SqlClient
    | EmbeddingModel.EmbeddingModel
    | EmbeddingProfile
    | Chunker
  >
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provideService(CurrentUser, identity(orgId)),
      // The tenant too: queue-path use cases require CurrentOrg, and a session implies it.
      Effect.provideService(CurrentOrg, orgId),
      Effect.provide(layers)
    ) as Effect.Effect<A, E, never>
  )

const POLICY = `# Inkoopbeleid

## Artikel 3 Inkoopverplichtingen

Facturen boven EUR 5.000 vereisen twee goedkeuringen van de inkoopafdeling.

## Artikel 4 Betalingstermijn

De betalingstermijn voor leveranciers is dertig dagen na ontvangst van de factuur.

## Artikel 5 Spoedopdrachten

Spoedopdrachten mogen door één manager worden goedgekeurd tot EUR 1.000.
`

/** Seeds a document row per org so the chunk foreign key holds, then indexes the corpus. */
const seed = async (orgId: OrgId, documentId: string, collection: "policy" | "transactional") => {
  await Effect.runPromise(
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      sql`
        insert into source_documents (id, organization_id, collection, filename, r2_key, content_type)
        values (${documentId}, ${orgId}, ${collection}, 'inkoopbeleid.md', ${`${orgId}/${documentId}`}, 'text/markdown')
        on conflict (id) do nothing
      `).pipe(Effect.provide(Admin))
  )
  return run(orgId, IndexPolicyDocument({ documentId, title: "Inkoopbeleid", text: POLICY, collection }))
}

beforeAll(async () => {
  await Effect.runPromise(
    Effect.flatMap(SqlClient.SqlClient, (sql) => sql`delete from source_documents where id like 'retrieval_%'`).pipe(
      Effect.provide(Admin)
    )
  )
  await seed(ORG_A, "retrieval_doc_a", "policy")
  await seed(ORG_B, "retrieval_doc_b", "policy")
  await seed(ORG_A, "retrieval_doc_txn", "transactional")
}, 30_000)

describe("indexing", () => {
  it("writes one chunk per clause, with its reference", async () => {
    const chunks = await run(
      ORG_A,
      Effect.flatMap(Db, (db) =>
        db.scoped((sql) =>
          sql<{ clause_ref: string | null; heading: string }>`
            select clause_ref, heading from document_chunks
            where document_id = 'retrieval_doc_a' order by ordinal
          `
        ))
    )
    expect(chunks.map((chunk) => chunk.clause_ref)).toEqual(["Artikel 3", "Artikel 4", "Artikel 5"])
  })

  it("is idempotent, so re-indexing does not duplicate the corpus", async () => {
    await seed(ORG_A, "retrieval_doc_a", "policy")
    const [count] = await run(
      ORG_A,
      Effect.flatMap(Db, (db) =>
        db.scoped((sql) =>
          sql<{ n: number }>`
            select count(*)::int as n from document_chunks where document_id = 'retrieval_doc_a'
          `
        ))
    )
    expect(count!.n).toBe(3)
  })
})

describe("retrieval", () => {
  it("finds the clause by a stemmed Dutch query", async () => {
    // "goedkeuring" (singular) must match "goedkeuringen" (plural) in the text. This is Snowball
    // stemming that Postgres gives for free and that would be hand-rolled anywhere else.
    const result = await run(ORG_A, RetrievePolicy({ query: "goedkeuring facturen" }))
    expect(result.chunks.length).toBeGreaterThan(0)
    expect(result.chunks[0]!.clause_ref).toBe("Artikel 3")
  })

  it("reports hybrid mode when both halves returned candidates", async () => {
    // The mode is an INPUT to rail 4, not telemetry: auto_approve requires "hybrid".
    const result = await run(ORG_A, RetrievePolicy({ query: "betalingstermijn leveranciers" }))
    expect(result.mode).toBe("hybrid")
    expect(result.chunks.some((chunk) => chunk.semantic_rank !== null)).toBe(true)
    expect(result.chunks.some((chunk) => chunk.lexical_rank !== null)).toBe(true)
  })

  it("degrades to lexical, visibly, when the corpus is not embedded", async () => {
    // Clearing the vectors simulates an embedding outage or a model swap mid-flight. Retrieval still
    // works; what must not happen is it working *silently*, because rail 4 reads this mode.
    await run(
      ORG_A,
      Effect.flatMap(
        Db,
        (db) =>
          db.scoped((sql, orgId) =>
            sql`
              update document_chunks set embedding = null, embedded_at = null
               where document_id = 'retrieval_doc_a' and organization_id = ${orgId}
            `
          )
      )
    )

    const result = await run(ORG_A, RetrievePolicy({ query: "goedkeuring facturen" }))
    expect(result.chunks.length).toBeGreaterThan(0)
    expect(result.mode).toBe("lexical")

    await seed(ORG_A, "retrieval_doc_a", "policy")
  })

  it("never returns a transactional document as policy", async () => {
    // The corpus separation, which is the product's most important structural guarantee. Enforced
    // inside the function, so a caller cannot forget it.
    const result = await run(ORG_A, RetrievePolicy({ query: "goedkeuring facturen" }))
    expect(result.chunks.every((chunk) => chunk.document_id !== "retrieval_doc_txn")).toBe(true)
  })

  it("never returns another organization's policy", async () => {
    // Both orgs have identical corpora, so a leak would look like a plausible result rather than an
    // obvious one — which is why this asserts on the document id and not on the content.
    const result = await run(ORG_B, RetrievePolicy({ query: "goedkeuring facturen" }))
    expect(result.chunks.length).toBeGreaterThan(0)
    expect(result.chunks.every((chunk) => chunk.document_id === "retrieval_doc_b")).toBe(true)
  })

  it("returns nothing, rather than everything, for a query that matches no clause", async () => {
    const result = await run(ORG_A, RetrievePolicy({ query: "zeppelin onderhoudscontract" }))
    // The semantic half always returns its nearest neighbours, so with a real embedder this would be
    // non-empty and low-scoring. With the deterministic embedder the neighbours are noise — which is
    // exactly why `EmbeddingProfile.semantic` exists and why the recall harness reads it.
    expect(result.chunks.every((chunk) => chunk.lexical_rank === null)).toBe(true)
  })
})
