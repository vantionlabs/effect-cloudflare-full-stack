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
import { Identity, OrgId, UserId } from "@ea/shared-domain/iam"
import { CurrentUser } from "@ea/shared-domain/iam"
import { PgClient } from "@effect/sql-pg"
import { Effect, Layer, Redacted } from "effect"
import { SqlClient } from "effect/sql"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Db } from "../src/Db.ts"
import { migrate } from "../src/Migrations.ts"

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
  host: "localhost",
  port: 55433,
  username: "effect_ai",
  password: Redacted.make("local_dev_only"),
  database: "effect_ai",
  ssl: false
})

/**
 * Application connection: same database, but `SET ROLE effect_ai_app` so RLS applies.
 *
 * Using a role rather than a second Postgres user keeps compose.yaml to one credential while
 * still exercising the non-superuser path that production uses.
 */
const App = Layer.effect(SqlClient.SqlClient)(
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`set role effect_ai_app`
    return sql
  })
).pipe(Layer.provideMerge(Admin))

const runAsOrg = <A, E>(orgId: OrgId, effect: Effect.Effect<A, E, Db | SqlClient.SqlClient | CurrentUser>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provideService(CurrentUser, identity(orgId)),
      Effect.provide(Db.layer),
      Effect.provide(App),
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

describe("row-level security", () => {
  it("shows a tenant only its own rows", async () => {
    const rows = await runAsOrg(
      ORG_A,
      Effect.flatMap(Db, (db) => db.scoped((sql) => sql<{ id: string }>`select id from source_documents`))
    )

    expect(rows.map((r) => r.id)).toEqual(["doc_a"])
  })

  it("hides another tenant's row even when asked for it by primary key", async () => {
    // The sharpest case: the caller knows the exact id. Without RLS this returns the row.
    const rows = await runAsOrg(
      ORG_B,
      Effect.flatMap(
        Db,
        (db) => db.scoped((sql) => sql<{ id: string }>`select id from source_documents where id = 'doc_a'`)
      )
    )

    expect(rows).toEqual([])
  })

  it("refuses to write a row attributed to another tenant", async () => {
    // This is what `with check` buys. Without it a tenant could insert data INTO another
    // organization and then be unable to see it — data written into a tenant that never
    // consented, invisible to the writer.
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

    // v4 renamed Either to Result, so a failure is Result.Failure rather than Left.
    expect(result._tag).toBe("Failure")
  })

  it("scopes updates, so one tenant cannot mutate another's row", async () => {
    await runAsOrg(
      ORG_A,
      Effect.flatMap(
        Db,
        (db) => db.scoped((sql) => sql`update source_documents set status = 'failed' where id = 'doc_b'`)
      )
    )

    // Verified as the owner, because the point is what actually happened in the table rather
    // than what org A was allowed to see afterwards.
    const rows = await Effect.runPromise(
      Effect.gen(function*() {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ status: string }>`select status from source_documents where id = 'doc_b'`
      }).pipe(Effect.provide(Admin), Effect.scoped) as Effect.Effect<Array<{ status: string }>>
    )

    expect(rows[0]?.status).toBe("uploaded")
  })

  it("sees nothing when the tenant GUC is unset", async () => {
    // Fail-closed check. `current_org()` returns NULL when `app.current_org` is unset, so every
    // policy matches nothing. A query that escapes the Db seam must return zero rows, never all
    // of them — this asserts the direction of that failure.
    const rows = await Effect.runPromise(
      Effect.gen(function*() {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ id: string }>`select id from source_documents`
      }).pipe(Effect.provide(App), Effect.scoped) as Effect.Effect<Array<{ id: string }>>
    )

    expect(rows).toEqual([])
  })
})
