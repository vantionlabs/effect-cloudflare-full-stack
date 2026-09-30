/**
 * The tenancy suite: proves row-level security actually isolates tenants.
 *
 * This is the test the plan calls the most valuable in the repo after the rule gate, because it
 * verifies the one property the type system *cannot* see. `CurrentUser` in an `R` channel proves
 * a caller obtained an identity; it says nothing about whether the SQL that ran respected it.
 * Only behaviour against a real Postgres with real policies can show that.
 *
 * Runs against the compose.yaml database, connecting as `effect_ai_app` — a non-superuser. That
 * matters: superusers and (unless forced) table owners bypass RLS entirely, so a suite run as the
 * owner would pass while proving nothing.
 */
import { CurrentUser, Identity, OrgId, UserId } from "@ea/domain/Identity"
import { PgClient } from "@effect/sql-pg"
import { Effect, Layer, Redacted } from "effect"
import { SqlClient } from "effect/sql"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Db } from "../Database/Db.ts"
import { migrate } from "../Migrations/Migrations.ts"

const ORG_A = OrgId.make("org_a")
const ORG_B = OrgId.make("org_b")

const identity = (orgId: OrgId) =>
  new Identity({
    userId: UserId.make("user_1"),
    orgId,
    email: "reviewer@example.com",
    role: "reviewer"
  })

/** Admin connection: runs migrations and seeds, deliberately NOT subject to RLS. */
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

/**
 * There is no separate application connection any more.
 *
 * It existed to `SET ROLE effect_ai_app` so that RLS applied — a superuser bypasses policies entirely. With
 * RLS removed (ADR-0014) the distinction buys nothing: isolation now comes from the predicate, which behaves
 * identically whoever connects. That is simpler, and it is also weaker, which is why `dep:check` refuses any
 * statement that omits the predicate.
 */

const runAsOrg = <A, E>(orgId: OrgId, effect: Effect.Effect<A, E, Db | SqlClient.SqlClient | CurrentUser>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provideService(CurrentUser, identity(orgId)),
      // One provide: `Db.layer` needs the connection `Admin` supplies (`multipleEffectProvide`).
      Effect.provide(Db.layer.pipe(Layer.provideMerge(Admin))),
      Effect.scoped
    ) as Effect.Effect<A, E>
  )

beforeAll(async () => {
  await Effect.runPromise(
    Effect.gen(function*() {
      yield* migrate
      const sql = yield* SqlClient.SqlClient
      // Seed one document per tenant, bypassing RLS as the owner so the fixtures exist
      // regardless of policy behaviour — otherwise a broken policy would look like a pass.
      yield* sql`delete from source_documents where organization_id in (${ORG_A}, ${ORG_B})`
      yield* sql`
        insert into source_documents (id, organization_id, collection, filename, r2_key, content_type)
        values
          ('doc_a', ${ORG_A}, 'policy', 'a.md', 'k/a', 'text/markdown'),
          ('doc_b', ${ORG_B}, 'policy', 'b.md', 'k/b', 'text/markdown')
      `
    }).pipe(Effect.provide(Admin), Effect.scoped) as Effect.Effect<void>
  )
})

afterAll(async () => {
  await Effect.runPromise(
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      yield* sql`delete from source_documents where organization_id in (${ORG_A}, ${ORG_B})`
    }).pipe(Effect.provide(Admin), Effect.scoped) as Effect.Effect<void>
  )
})

/**
 * What the seam guarantees now, and what it does not.
 *
 * These tests changed shape when RLS was removed (ADR-0014), and the change is worth understanding rather
 * than skimming. Under RLS a query *without* a predicate returned only the caller's rows, so the tests could
 * assert isolation directly and a leak was a test failure. Now the predicate is the isolation, so a test that
 * writes the predicate itself proves almost nothing — it asserts that `where organization_id = $1` filters,
 * which Postgres does.
 *
 * So these assert the part that is genuinely ours: **that `Db.scoped` supplies the AUTHENTICATED
 * organization** and that a caller cannot influence it. The complementary halves live elsewhere, and all
 * three are needed:
 *
 *   - `bun run dep:check` fails any statement touching a tenant table without the predicate. That is what
 *     replaced RLS, and it found 16 offenders the day RLS came out.
 *   - each use case has its own cross-tenant test (ListIntakes, Decision.queue, Intake.list over RPC),
 *     because a leak now lives in a specific query rather than in a missing policy.
 *   - the inverted fail-open test below states the exposure out loud.
 */
describe("the org-scoping seam", () => {
  it("supplies the authenticated organization, not one the caller chose", async () => {
    /*
     * The guarantee that survived. `scoped` reads `CurrentUser` and hands its `orgId` to the callback; there
     * is no overload accepting one, so a caller cannot name a tenant even deliberately. This asserts the
     * wiring — identity in, correct org id out — which is the part a bug could break.
     */
    const seen = await runAsOrg(
      ORG_A,
      Effect.flatMap(Db, (db) => db.scoped((_sql, orgId) => Effect.succeed(orgId)))
    )
    expect(seen).toBe(ORG_A)

    const other = await runAsOrg(
      ORG_B,
      Effect.flatMap(Db, (db) => db.scoped((_sql, orgId) => Effect.succeed(orgId)))
    )
    expect(other).toBe(ORG_B)
  })

  it("returns only the caller's rows when the predicate uses the supplied id", async () => {
    const rows = await runAsOrg(
      ORG_A,
      Effect.flatMap(Db, (db) =>
        db.scoped((sql, orgId) =>
          sql<{ id: string }>`
            select id from source_documents where organization_id = ${orgId}
          `
        ))
    )
    expect(rows.map((row) => row.id)).toEqual(["doc_a"])
  })

  it("does not return another tenant's row even when the id is known", async () => {
    // Still worth asserting: the sharpest shape of the query, where the caller has the exact primary key.
    // The predicate must be conjunctive with the id, not an alternative to it.
    const rows = await runAsOrg(
      ORG_B,
      Effect.flatMap(Db, (db) =>
        db.scoped((sql, orgId) =>
          sql<{ id: string }>`
            select id from source_documents where id = 'doc_a' and organization_id = ${orgId}
          `
        ))
    )
    expect(rows).toEqual([])
  })

  it("no longer refuses a write attributed to another tenant — and that is the trade", async () => {
    /*
     * This test asserted the opposite until RLS was removed, and `with check` was what made it pass: a policy
     * rejected an insert naming another organization, so data could not be written INTO a tenant that never
     * consented and be invisible to the writer.
     *
     * That protection is gone. The only thing preventing it now is that `Db.scoped` hands the caller its own
     * `orgId` and no code path supplies a different one — a compile-time property, not a runtime one. Stated
     * as a passing test rather than deleted, so the trade is visible in the suite rather than only in an ADR.
     */
    const result = await runAsOrg(
      ORG_A,
      Effect.flatMap(Db, (db) =>
        db.scoped((sql) =>
          sql`
            insert into source_documents (id, organization_id, collection, filename, r2_key, content_type)
            values ('doc_x', ${ORG_B}, 'policy', 'x.md', 'k/x', 'text/markdown')
          `
        )).pipe(Effect.result)
    )

    expect(result._tag, "a database-level guard has reappeared; update ADR-0014").toBe("Success")

    await Effect.runPromise(
      Effect.flatMap(SqlClient.SqlClient, (sql) => sql`delete from source_documents where id = 'doc_x'`)
        .pipe(Effect.provide(Admin)) as Effect.Effect<unknown>
    )
  })

  it("FAILS OPEN when a query escapes the seam — the cost of removing RLS, asserted", async () => {
    /*
     * Under RLS this returned zero rows: `current_org()` was NULL outside `Db.scoped`, so every policy matched
     * nothing and the system failed closed. That test passed for weeks and is now false — a query escaping the
     * seam sees **every tenant's rows**.
     *
     * Inverted rather than deleted, so the regression is a fact the suite states out loud and `dep:check` is
     * visibly the only thing standing in the way. If this ever fails, fail-closed behaviour has been restored
     * — good news, and an instruction to update ADR-0014 rather than to fix the test.
     */
    const rows = await Effect.runPromise(
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) => sql<{ organization_id: string }>`select organization_id from source_documents`
      ).pipe(Effect.provide(Admin)) as Effect.Effect<Array<{ organization_id: string }>>
    )

    expect(
      new Set(rows.map((row) => row.organization_id)).size,
      "a raw query saw one organization; has fail-closed behaviour been restored?"
    ).toBeGreaterThan(1)
  })
})
