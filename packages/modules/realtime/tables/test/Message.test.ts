/**
 * Messages against real Postgres: ordering, keyset paging, the author join, and tenancy.
 *
 * The ordering tests matter most, because the design leans on a property of the ids rather than on a column:
 * UUIDv7 is time-ordered, so `order by id` is chronological and `id >` is a cursor. If that stops being true —
 * a different generator, a caller passing its own id — a thread silently reorders and a reconnecting client
 * silently skips messages. Neither would fail any other test.
 */
import { DeleteMessage, EditMessage, ListMessages, PostMessage } from "@ea/modules/realtime/use-cases/Message"
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

/**
 * The failure a use case produced, as a value.
 *
 * `Effect.flip` rather than `rejects.toThrow(/Tag/)`, because a `Schema.TaggedError` is an `Error` whose
 * `.message` is usually EMPTY — the trap in AGENTS.md. Matching on the message therefore compares against `''`
 * and passes for any failure at all, which is worse than no assertion. Flipping gives the error value, so the
 * assertion is on `_tag`, which is the thing a caller actually branches on.
 */
const failureOf = <A, E>(identity: Identity, effect: Effect.Effect<A, E, any>) => runAs(identity, Effect.flip(effect))

const alice = identityIn(ORG_A, "msg_user_alice", "alice@example.test")
const bob = identityIn(ORG_A, "msg_user_bob", "bob@example.test")
const intruder = identityIn(ORG_B, "msg_user_other", "other@example.test")

/** A decision thread, named by the decision so the room is created on first use. */
const thread = (decisionId: string) => ({ _tag: "RoomForDecision" as const, decisionId })

beforeEach(async () => {
  counter = 0
  await asAdmin(Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    // Messages cascade from rooms, but delete them first so a failed run cannot leave orphans behind.
    yield* sql`delete from messages where id like 'msg_%'`
    yield* sql`delete from rooms where organization_id in (${ORG_A}, ${ORG_B})`
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
  it("creates the decision's room on the first message, and reuses it after", async () => {
    const first = await runAs(alice, PostMessage({ room: thread("dec_1"), body: "hello" }))
    const second = await runAs(bob, PostMessage({ room: thread("dec_1"), body: "again" }))

    /*
     * The same room, which is the whole point of lazy creation: a thread is addressed by its decision and the
     * row appears once. A second room here would mean two halves of one conversation.
     */
    expect(second.roomId).toBe(first.roomId)
    expect(first.body).toBe("hello")
    expect(first.authorEmail).toBe("alice@example.test")
  })

  it("refuses an empty body at the database, not only in the schema", async () => {
    /*
     * The wire schema rejects this first, so this asserts the second line of defence: the CHECK constraint,
     * which also covers anything writing without going through the contract. Whitespace only, because
     * `length > 0` alone would let a space through.
     */
    await expect(runAs(alice, PostMessage({ room: thread("dec_1"), body: "   " }))).rejects.toThrow()
  })

  it("refuses a room id this organization does not have", async () => {
    const mine = await runAs(alice, PostMessage({ room: thread("dec_mine"), body: "mine" }))

    /*
     * The tenancy case, by ROOM ID — the one identifier a caller could plausibly guess or be given. Every read
     * is scoped (ADR-0014), so from another organization the room simply is not there, and the error says
     * exactly what it would say for an id that never existed.
     */
    expect(
      (await failureOf(intruder, PostMessage({ room: { _tag: "RoomById", roomId: mine.roomId }, body: "theirs" })))
        ._tag
    ).toBe("RoomNotFound")
  })
})

describe("ListMessages", () => {
  it("returns a thread oldest first", async () => {
    await runAs(alice, PostMessage({ room: thread("dec_1"), body: "first" }))
    await runAs(bob, PostMessage({ room: thread("dec_1"), body: "second" }))
    await runAs(alice, PostMessage({ room: thread("dec_1"), body: "third" }))

    const messages = await runAs(alice, ListMessages({ room: thread("dec_1") }))
    expect(messages.map((message) => message.body)).toEqual(["first", "second", "third"])
  })

  it("reads an empty thread rather than creating one", async () => {
    const before = await runAs(alice, ListMessages({ room: thread("dec_never_used") }))
    expect(before).toEqual([])

    /*
     * And it wrote nothing while doing so. A reader that created rooms would leave one behind for every
     * decision anybody ever opened, which is the reason `create` is a parameter of `ResolveRoom`.
     */
    const rooms = await asAdmin(Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      return yield* sql<{ count: string }>`
        select count(*)::text as count from rooms
         where organization_id = ${ORG_A} and subject_id = 'dec_never_used'
      `
    }))
    expect(rooms[0]?.count).toBe("0")
  })

  it("joins the author's email, and tolerates an author who no longer exists", async () => {
    await runAs(alice, PostMessage({ room: thread("dec_1"), body: "from alice" }))
    // Bob has no row in better-auth's table, which is what a deleted user looks like.
    await runAs(bob, PostMessage({ room: thread("dec_1"), body: "from bob" }))

    const messages = await runAs(alice, ListMessages({ room: thread("dec_1") }))
    expect(messages.map((message) => message.authorEmail)).toEqual(["alice@example.test", null])
    // The message survives the author: an audit trail that erases what somebody said is not one.
    expect(messages[1]?.body).toBe("from bob")
  })

  it("pages by cursor, which is also how a reconnecting client catches up", async () => {
    await runAs(alice, PostMessage({ room: thread("dec_1"), body: "one" }))
    const second = await runAs(alice, PostMessage({ room: thread("dec_1"), body: "two" }))
    await runAs(alice, PostMessage({ room: thread("dec_1"), body: "three" }))

    const after = await runAs(alice, ListMessages({ room: thread("dec_1"), after: second.id }))
    // Strictly after: the cursor message is not repeated, which is what makes appending safe.
    expect(after.map((message) => message.body)).toEqual(["three"])
  })

  it("keeps rooms apart", async () => {
    await runAs(alice, PostMessage({ room: thread("dec_1"), body: "about one" }))
    await runAs(alice, PostMessage({ room: thread("dec_2"), body: "about two" }))

    expect((await runAs(alice, ListMessages({ room: thread("dec_1") }))).map((m) => m.body)).toEqual(["about one"])
    expect((await runAs(alice, ListMessages({ room: thread("dec_2") }))).map((m) => m.body)).toEqual(["about two"])
  })

  it("never shows another organization's thread, even with the same decision", async () => {
    await runAs(alice, PostMessage({ room: thread("dec_shared"), body: "org A only" }))
    await runAs(intruder, PostMessage({ room: thread("dec_shared"), body: "org B only" }))

    /*
     * Two organizations discussing the same decision id get two rooms, because the unique index is on
     * (organization_id, subject_id). Neither can see the other's, which is the property the whole tenancy seam
     * exists for.
     */
    expect((await runAs(alice, ListMessages({ room: thread("dec_shared") }))).map((m) => m.body))
      .toEqual(["org A only"])
    expect((await runAs(intruder, ListMessages({ room: thread("dec_shared") }))).map((m) => m.body))
      .toEqual(["org B only"])
  })
})

describe("EditMessage and DeleteMessage", () => {
  it("records that a message was edited, because an edited record is not the original", async () => {
    const message = await runAs(alice, PostMessage({ room: thread("dec_1"), body: "the PO matches" }))
    const edited = await runAs(alice, EditMessage({ messageId: message.id, body: "the PO matches, checked twice" }))
    expect(edited.editedAt).toMatch(/^\d{4}-/)

    const [read] = await runAs(alice, ListMessages({ room: thread("dec_1") }))
    expect(read?.body).toBe("the PO matches, checked twice")
    /*
     * Surfaced, not hidden. In a thread attached to a decision, a reader who cannot tell an edited note from an
     * original is worse off than one who sees "edited" — the same instinct as recording `retrieval_mode`.
     */
    expect(read?.editedAt).not.toBeNull()
  })

  it("lets only the author edit or delete", async () => {
    const message = await runAs(alice, PostMessage({ room: thread("dec_1"), body: "mine" }))

    /*
     * No moderator override, deliberately: somebody who can rewrite what a colleague said in a decision's thread
     * can rewrite the record of why that decision was made. Administrative deletion is a real requirement and
     * belongs in its own operation with its own audit row, not as a relaxation of this check.
     */
    expect((await failureOf(bob, EditMessage({ messageId: message.id, body: "not mine" })))._tag)
      .toBe("NotMessageAuthor")
    expect((await failureOf(bob, DeleteMessage({ messageId: message.id })))._tag).toBe("NotMessageAuthor")

    // And the message is untouched.
    expect((await runAs(alice, ListMessages({ room: thread("dec_1") })))[0]?.body).toBe("mine")
  })

  it("redacts the body on delete and keeps the row", async () => {
    await runAs(alice, PostMessage({ room: thread("dec_1"), body: "first" }))
    const second = await runAs(alice, PostMessage({ room: thread("dec_1"), body: "sensitive" }))

    await runAs(alice, DeleteMessage({ messageId: second.id }))

    const messages = await runAs(alice, ListMessages({ room: thread("dec_1") }))
    /*
     * The row survives and the content does not. Who spoke, when, and that they removed it stay recorded —
     * which is the auditable part — while "delete" means what a user expects it to mean.
     */
    expect(messages).toHaveLength(2)
    expect(messages[1]?.deletedAt).not.toBeNull()
    expect(messages[1]?.body).not.toContain("sensitive")
    expect(messages[1]?.authorUserId).toBe("msg_user_alice")
  })

  it("treats deleting twice as success, and refuses to edit a deleted message", async () => {
    const message = await runAs(alice, PostMessage({ room: thread("dec_1"), body: "gone" }))
    await runAs(alice, DeleteMessage({ messageId: message.id }))

    // Double-clicking a delete button is not an error.
    await runAs(alice, DeleteMessage({ messageId: message.id }))

    /*
     * Editing it back would let somebody restore content they had removed, which is the opposite of what
     * deleting promised. Reported as not found, because from the author's point of view it is gone.
     */
    expect((await failureOf(alice, EditMessage({ messageId: message.id, body: "back" })))._tag)
      .toBe("MessageNotFound")
  })

  it("refuses to edit another organization's message with the not-found error", async () => {
    const mine = await runAs(alice, PostMessage({ room: thread("dec_x"), body: "ours" }))
    /*
     * Not `NotMessageAuthor`: from another tenant the message is not merely somebody else's, it is invisible, and
     * saying otherwise would confirm that the id exists.
     */
    expect((await failureOf(intruder, EditMessage({ messageId: mine.id, body: "theirs" })))._tag)
      .toBe("MessageNotFound")
  })
})
