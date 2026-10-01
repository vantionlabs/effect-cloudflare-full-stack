/**
 * Usage metering against real Postgres: the properties an invoice depends on.
 *
 * Every assertion here is about a way a meter could be WRONG rather than missing — counted twice, counted for the
 * wrong tenant, or counted on the wrong side of a period boundary. Those are the failures nobody notices until a
 * customer disputes an invoice, and none of them is visible to a test that only checks a row was written.
 */
import { Db } from "@ea/database/Database"
import { CurrentUser, Identity, OrgId, UserId } from "@ea/domain/Identity"
import { modelUsageEntries, type UsageEntry } from "@ea/modules/shared/domain/Usage"
import { currentMonth, GetUsage, writeUsage } from "@ea/modules/shared/use-cases/Usage"
import { PgClient } from "@effect/sql-pg"
import { Effect, Layer, Redacted } from "effect"
import { SqlClient } from "effect/sql"
import { beforeEach, describe, expect, it } from "vitest"

const ORG_A = OrgId.make("usage_org_a")
const ORG_B = OrgId.make("usage_org_b")

const Admin = PgClient.layer({
  host: process.env["PGHOST"] ?? "localhost",
  port: Number(process.env["PGPORT"] ?? 55433),
  username: process.env["PGUSER"] ?? "effect_ai",
  password: Redacted.make(process.env["PGPASSWORD"] ?? "local_dev_only"),
  database: process.env["PGDATABASE"] ?? "effect_ai",
  ssl: false
})

const asOrg = <A, E>(orgId: OrgId, effect: Effect.Effect<A, E, Db | SqlClient.SqlClient | CurrentUser>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provideService(
        CurrentUser,
        new Identity({ userId: UserId.make("u"), orgId, email: "u@example.com", role: "reviewer" })
      ),
      Effect.provide(Db.layer.pipe(Layer.provideMerge(Admin)))
    ) as Effect.Effect<A, E, never>
  )

const asAdmin = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(Admin)) as Effect.Effect<A, E, never>)

/** Writes through the real helper, in a real tenant-scoped transaction, the way a use case does. */
const record = (orgId: OrgId, entries: ReadonlyArray<UsageEntry>) =>
  asOrg(orgId, Effect.flatMap(Db, (db) => db.scoped((sql, org) => writeUsage(sql, org, entries))))

/** Backdates every row of an org, so period boundaries can be tested without waiting for midnight. */
const backdate = (orgId: OrgId, at: string) =>
  asAdmin(
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      sql`update usage_records set recorded_at = ${at}::timestamptz where organization_id = ${orgId}`)
  )

const report = (orgId: OrgId, period = currentMonth(new Date())) => asOrg(orgId, GetUsage(period))

const totalOf = (r: Awaited<ReturnType<typeof report>>, meter: string, model: string | null = null) =>
  r.totals.find((row) => row.meter === meter && row.model === model)?.quantity ?? 0

beforeEach(async () => {
  await asAdmin(
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql`delete from usage_records where organization_id in (${ORG_A}, ${ORG_B})`
    )
  )
})

describe("billable units count once", () => {
  it("a replayed write with the same key is not counted again", async () => {
    const ingest: UsageEntry = { meter: "documents.ingested", quantity: 1, idempotencyKey: "intake:i1" }
    await record(ORG_A, [ingest])
    await record(ORG_A, [ingest])
    await record(ORG_A, [ingest])
    expect(totalOf(await report(ORG_A), "documents.ingested")).toBe(1)
  })

  it("the same key in another organization is a different unit", async () => {
    // Keys are unique PER organization: one tenant's id can never suppress another tenant's meter.
    await record(ORG_A, [{ meter: "documents.ingested", quantity: 1, idempotencyKey: "intake:shared" }])
    await record(ORG_B, [{ meter: "documents.ingested", quantity: 1, idempotencyKey: "intake:shared" }])
    expect(totalOf(await report(ORG_A), "documents.ingested")).toBe(1)
    expect(totalOf(await report(ORG_B), "documents.ingested")).toBe(1)
  })
})

describe("cost is counted every time", () => {
  it("two identical model calls are two rows of spend, summed per model", async () => {
    const call = modelUsageEntries({ model: "@cf/meta/llama-3.3-70b", inputTokens: 1200, outputTokens: 300 })
    await record(ORG_A, call)
    await record(ORG_A, call)
    await record(ORG_A, modelUsageEntries({ model: "@cf/small", inputTokens: 10, outputTokens: 5 }))

    const r = await report(ORG_A)
    expect(totalOf(r, "model.input_tokens", "@cf/meta/llama-3.3-70b")).toBe(2400)
    expect(totalOf(r, "model.output_tokens", "@cf/meta/llama-3.3-70b")).toBe(600)
    expect(totalOf(r, "model.input_tokens", "@cf/small")).toBe(10)
  })

  it("a zero quantity writes nothing, because a meter row claims something was consumed", async () => {
    await record(ORG_A, modelUsageEntries({ model: "m", inputTokens: 0, outputTokens: 7 }))
    const r = await report(ORG_A)
    expect(totalOf(r, "model.input_tokens", "m")).toBe(0)
    expect(r.totals.filter((row) => row.meter === "model.input_tokens")).toHaveLength(0)
    expect(totalOf(r, "model.output_tokens", "m")).toBe(7)
  })
})

describe("a report sees only its own organization and its own period", () => {
  it("never includes another organization's rows", async () => {
    await record(ORG_B, [{ meter: "decisions.completed", quantity: 1, idempotencyKey: "decide:x" }])
    expect((await report(ORG_A)).totals).toEqual([])
  })

  it("is half-open on UTC midnight: the last second of a month is in it, the first of the next is not", async () => {
    await record(ORG_A, [{ meter: "documents.ingested", quantity: 1, idempotencyKey: "intake:late" }])
    await backdate(ORG_A, "2026-09-30T23:59:59Z")
    await record(ORG_A, [{ meter: "documents.ingested", quantity: 1, idempotencyKey: "intake:early" }])
    await asAdmin(
      Effect.flatMap(SqlClient.SqlClient, (sql) =>
        sql`update usage_records set recorded_at = '2026-10-01T00:00:00Z'
           where organization_id = ${ORG_A} and idempotency_key = 'intake:early'`)
    )

    const september = await report(ORG_A, { from: "2026-09-01", to: "2026-10-01" })
    const october = await report(ORG_A, { from: "2026-10-01", to: "2026-11-01" })
    expect(totalOf(september, "documents.ingested")).toBe(1)
    expect(totalOf(october, "documents.ingested")).toBe(1)
    expect(september.daily).toEqual([{ day: "2026-09-30", meter: "documents.ingested", quantity: 1 }])
  })
})

describe("the vocabulary is closed in the database too", () => {
  it("refuses a meter nobody declared", async () => {
    const attempt = asAdmin(
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) => sql`insert into usage_records (organization_id, meter, quantity) values (${ORG_A}, 'made.up', 1)`
      )
    )
    await expect(attempt).rejects.toBeDefined()
  })
})
