/**
 * Messages against real Postgres: ordering, keyset paging, the author join, and tenancy.
 *
 * The ordering tests are the ones that matter most, because the design leans on a property of the ids rather
 * than on a column: UUIDv7 is time-ordered, so `order by id` is chronological and `id >` is a cursor. If that
 * ever stops being true — a different generator, a caller passing its own id — a thread silently reorders and
 * a reconnecting client silently skips messages. Neither would fail any other test.
 */
import { ListMessages, PostMessage } from "@ea/modules/realtime/use-cases/Message"
import { CurrentOrg, CurrentUser, Identity, OrgId, UserId } from "@ea/modules/shared/domain/Identity"
import { Ids } from "@ea/modules/shared/domain/Ids"
import { Db } from "@ea/modules/shared/tables/Database"
import { PgClient } from "@effect/sql-pg"
import { Effect, Layer, Redacted } from "effect"
import { SqlClient } from "effect/sql"
import { beforeEach, describe, expect, it } from "vitest"

const ORG_A = OrgId.make("msg_org_a")
const ORG_B = OrgId.make("msg_org_b")

const Admin = PgClient.layer({
  host: process.env["PGHOST"] ?? "localhost",
  port: Number(process.env["PGPORT"] ?? 55433),
  username: process.env["PGUSER"] ?? "effect_ai",
  password: Redacted.make(process.env["PGPASSWORD"] ?? "local_dev_only"),
  database: process.env["PGDATABASE"] ?? "effect_ai",
  ssl: false
})

/**
 * Monotonic ids, because the production generator is UUIDv7 and the ordering under test is its
 * time-orderedness. `crypto.randomUUID()` would be random, so a passing test would prove nothing about the
 * property the design actually relies on.
 */
let counter = 0
const IdsLive = Layer.succeed(Ids)({
  next: Effect.sync(() => `msg_${String(counter++).padStart(6, "0")}`)
})

const identityIn = (orgId: OrgId, userId: string, email: string) =>
  new Identity({ userId: UserId.make(userId), orgId, email, role: "reviewer" })

const runAs = <A, E>(identity: Identity, effect: Effect.Effect<A, E, any>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provideService(CurrentUser, identity),
      Effect.provideService(CurrentOrg, identity.orgId),
      Effect.provide(Layer.mergeAll(Db.layer, IdsLive).pipe(Layer.provideMerge(Admin)))
    ) as Effect.Effect<A, E, never>
  )

const asAdmin = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(Admin)) as Effect.Effect<A, E, never>)

const alice = identityIn(ORG_A, "msg_user_alice", "alice@example.test")
const bob = identityIn(ORG_A, "msg_user_bob", "bob@example.test")
const intruder = identityIn(ORG_B, "msg_user_other", "other@example.test")

beforeEach(async () => {
  counter = 0
  await asAdmin(Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`delete from messages where id like 'msg_%'`
    yield* sql`delete from "user" where id like 'msg_user_%'`
    /*
     * A real row in better-auth's table, so the LEFT join has something to find. Inserted rather than mocked
     * because the join is the thing under test: `authorEmail` comes from there, not from the message row.
     */
    yield* sql`
      insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      values ('msg_user_alice', 'Alice', 'alice@example.test', true, now(), now())
      on conflict (id) do nothing
    `
  }))
})

describe("PostMessage", () => {
  it("stores the message and returns the row a client should render", async () => {
    const message = await runAs(alice, PostMessage({ subjectKind: "decision", subjectId: "dec_1", body: "hello" }))

    expect(message.body).toBe("hello")
    expect(message.subject).toEqual({ kind: "decision", id: "dec_1" })
    expect(message.authorUserId).toBe("msg_user_alice")
    // From the session, not a second query — see PostMessage.ts.
    expect(message.authorEmail).toBe("alice@example.test")
    expect(message.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it("refuses an empty body at the database, not only in the schema", async () => {
    /*
     * The wire schema rejects this first, so this asserts the second line of defence: the CHECK constraint,
     * which also covers anything writing without going through the contract — a script, a migration, a future
     * transport. Whitespace only, because `length > 0` alone would let a space through.
     */
    await expect(
      runAs(alice, PostMessage({ subjectKind: "decision", subjectId: "dec_1", body: "   " }))
    ).rejects.toThrow()
  })
})

describe("ListMessages", () => {
  it("returns a thread oldest first", async () => {
    await runAs(alice, PostMessage({ subjectKind: "decision", subjectId: "dec_1", body: "first" }))
    await runAs(bob, PostMessage({ subjectKind: "decision", subjectId: "dec_1", body: "second" }))
    await runAs(alice, PostMessage({ subjectKind: "decision", subjectId: "dec_1", body: "third" }))

    const thread = await runAs(alice, ListMessages({ subjectKind: "decision", subjectId: "dec_1" }))
    expect(thread.map((message) => message.body)).toEqual(["first", "second", "third"])
  })

  it("joins the author's email, and tolerates an author who no longer exists", async () => {
    await runAs(alice, PostMessage({ subjectKind: "decision", subjectId: "dec_1", body: "from alice" }))
    // Bob has no row in better-auth's table, which is what a deleted user looks like.
    await runAs(bob, PostMessage({ subjectKind: "decision", subjectId: "dec_1", body: "from bob" }))

    const thread = await runAs(alice, ListMessages({ subjectKind: "decision", subjectId: "dec_1" }))
    expect(thread.map((message) => message.authorEmail)).toEqual(["alice@example.test", null])
    /*
     * The message survives the author. A LEFT join rather than an inner one, because an audit trail that
     * erases what somebody said when their account goes is not an audit trail.
     */
    expect(thread[1]?.body).toBe("from bob")
  })

  it("pages by cursor, which is also how a reconnecting client catches up", async () => {
    await runAs(alice, PostMessage({ subjectKind: "decision", subjectId: "dec_1", body: "one" }))
    const second = await runAs(alice, PostMessage({ subjectKind: "decision", subjectId: "dec_1", body: "two" }))
    await runAs(alice, PostMessage({ subjectKind: "decision", subjectId: "dec_1", body: "three" }))

    const after = await runAs(
      alice,
      ListMessages({ subjectKind: "decision", subjectId: "dec_1", after: second.id })
    )
    // Strictly after: the cursor message is not repeated, which is what makes appending safe.
    expect(after.map((message) => message.body)).toEqual(["three"])
  })

  it("keeps subjects apart", async () => {
    await runAs(alice, PostMessage({ subjectKind: "decision", subjectId: "dec_1", body: "about one" }))
    await runAs(alice, PostMessage({ subjectKind: "decision", subjectId: "dec_2", body: "about two" }))
    // Same id, different kind: the tenant-wide channel must not pick up a decision thread.
    await runAs(alice, PostMessage({ subjectKind: "organization", subjectId: "dec_1", body: "channel" }))

    expect(
      (await runAs(alice, ListMessages({ subjectKind: "decision", subjectId: "dec_1" })))
        .map((message) => message.body)
    ).toEqual(["about one"])
    expect(
      (await runAs(alice, ListMessages({ subjectKind: "organization", subjectId: "dec_1" })))
        .map((message) => message.body)
    ).toEqual(["channel"])
  })

  it("never shows another organization's thread, even with the right subject id", async () => {
    await runAs(alice, PostMessage({ subjectKind: "decision", subjectId: "dec_shared", body: "org A only" }))

    /*
     * The tenancy case, and the reason `PostMessage` does not bother checking that a subject exists: a caller
     * from another organization holding the exact subject id still reads nothing, because every query is
     * scoped by `Db.scoped` (ADR-0014). The worst they can do is create a thread inside their own tenant.
     */
    const asIntruder = await runAs(intruder, ListMessages({ subjectKind: "decision", subjectId: "dec_shared" }))
    expect(asIntruder).toEqual([])

    await runAs(intruder, PostMessage({ subjectKind: "decision", subjectId: "dec_shared", body: "org B" }))
    expect(
      (await runAs(alice, ListMessages({ subjectKind: "decision", subjectId: "dec_shared" })))
        .map((message) => message.body)
    ).toEqual(["org A only"])
  })
})
