/**
 * Channels against real Postgres: slugs, collisions, archiving, and the lazy-creation race.
 *
 * The race test is the one that would be tempting to skip and is the reason the partial unique index exists. Two
 * people opening the same decision at the same moment both find no thread and both insert; without the index one
 * of them wins and the other's messages land in a second room holding half the conversation.
 */
import { Db } from "@ea/database/Database"
import { CurrentOrg, CurrentUser, Identity, OrgId, UserId } from "@ea/domain/Identity"
import { Ids } from "@ea/domain/Ids"
import { PostMessage } from "@ea/modules/realtime/use-cases/Message"
import { MarkRead } from "@ea/modules/realtime/use-cases/Read"
import { ArchiveRoom, CreateRoom, ListRooms, ResolveRoom } from "@ea/modules/realtime/use-cases/Room"
import { PgClient } from "@effect/sql-pg"
import { Effect, Layer, Redacted } from "effect"
import { SqlClient } from "effect/sql"
import { beforeEach, describe, expect, it } from "vitest"

const ORG_A = OrgId.make("room_org_a")
const ORG_B = OrgId.make("room_org_b")

const Admin = PgClient.layer({
  host: process.env["PGHOST"] ?? "localhost",
  port: Number(process.env["PGPORT"] ?? 55433),
  username: process.env["PGUSER"] ?? "effect_ai",
  password: Redacted.make(process.env["PGPASSWORD"] ?? "local_dev_only"),
  database: process.env["PGDATABASE"] ?? "effect_ai",
  ssl: false
})

/**
 * Monotonic prefix, random suffix — the shape of a real UUIDv7, and both halves are load-bearing here.
 *
 * The suffix keeps two rooms from colliding on their primary key while racing, which is what the concurrency test
 * needs. The PREFIX is what makes ids sort in creation order, which is what unread counts and the keyset cursor
 * both rely on: `m.id > last_read` is only "later than" if ids are time-ordered.
 *
 * A purely random generator passed every other test in this file and made the unread test fail by one — the
 * third message sorted before the second. Worth the comment, because a fake that is unique but unordered looks
 * perfectly reasonable.
 */
let counter = 0
const IdsLive = Layer.succeed(Ids)({
  next: Effect.sync(() => `room_${String(counter++).padStart(6, "0")}_${crypto.randomUUID().slice(0, 8)}`)
})

const identityIn = (orgId: OrgId, userId: string) =>
  new Identity({ userId: UserId.make(userId), orgId, email: `${userId}@example.test`, role: "reviewer" })

const alice = identityIn(ORG_A, "room_user_alice")
const other = identityIn(ORG_B, "room_user_other")

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

const bob = identityIn(ORG_A, "room_user_bob")

beforeEach(async () => {
  counter = 0
  await asAdmin(Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    // Messages, reads and reactions all cascade from rooms; deleting rooms is enough and says so.
    yield* sql`delete from rooms where organization_id in (${ORG_A}, ${ORG_B})`
  }))
})

describe("CreateRoom", () => {
  it("derives a slug from the name", async () => {
    const room = await runAs(alice, CreateRoom({ name: "Billing Questions", topic: "invoices and POs" }))
    expect(room.slug).toBe("billing-questions")
    expect(room.name).toBe("Billing Questions")
    expect(room.topic).toBe("invoices and POs")
    expect(room.kind).toBe("channel")
    expect(room.archivedAt).toBeNull()
  })

  it("refuses a second channel with the same slug, rather than inventing one", async () => {
    await runAs(alice, CreateRoom({ name: "Billing" }))

    /*
     * `#billing` and `#billing-2` are two places people post the same thing. Refusing tells the user the channel
     * exists, which is usually what they wanted to know — and the collision is on the SLUG, so a different name
     * that slugifies the same is still a conflict.
     */
    expect((await failureOf(alice, CreateRoom({ name: "billing" })))._tag).toBe("RoomSlugTaken")
    expect((await failureOf(alice, CreateRoom({ name: "  BILLING  " })))._tag).toBe("RoomSlugTaken")
  })

  it("lets another organization use the same slug", async () => {
    await runAs(alice, CreateRoom({ name: "Billing" }))
    const theirs = await runAs(other, CreateRoom({ name: "Billing" }))
    // The unique index is per organization: a shared vocabulary across tenants would be the bug.
    expect(theirs.slug).toBe("billing")
  })

  it("refuses a name that slugifies to nothing", async () => {
    /*
     * Emoji and punctuation collapse to an empty slug. A channel nobody can address is a worse outcome than
     * being asked for a different name — and the alternative, a generated handle, is a name the user did not
     * choose and cannot predict.
     */
    expect((await failureOf(alice, CreateRoom({ name: "🎉🎉🎉" })))._tag).toBe("RoomNameInvalid")
    expect((await failureOf(alice, CreateRoom({ name: "!!!" })))._tag).toBe("RoomNameInvalid")
  })
})

describe("ListRooms", () => {
  it("lists channels by name and hides archived ones", async () => {
    await runAs(alice, CreateRoom({ name: "Zebra" }))
    const billing = await runAs(alice, CreateRoom({ name: "Billing" }))
    await runAs(alice, CreateRoom({ name: "Alerts" }))
    await runAs(alice, ArchiveRoom({ roomId: billing.id, archived: true }))

    const rooms = await runAs(alice, ListRooms())
    expect(rooms.map((room) => room.name)).toEqual(["Alerts", "Zebra"])
  })

  it("does not list decision threads", async () => {
    /*
     * A thread per decision would make this endpoint grow with the queue rather than with the channel list, and
     * threads are reached through their decision anyway.
     */
    await runAs(alice, ResolveRoom({ _tag: "RoomForDecision", decisionId: "dec_x" }, { create: true }))
    expect(await runAs(alice, ListRooms())).toEqual([])
  })

  it("never lists another organization's channels", async () => {
    await runAs(alice, CreateRoom({ name: "Ours" }))
    expect(await runAs(other, ListRooms())).toEqual([])
  })
})

describe("ArchiveRoom", () => {
  it("archives and restores, without losing anything", async () => {
    const room = await runAs(alice, CreateRoom({ name: "Temporary" }))

    const archived = await runAs(alice, ArchiveRoom({ roomId: room.id, archived: true }))
    expect(archived.archivedAt).not.toBeNull()

    const restored = await runAs(alice, ArchiveRoom({ roomId: room.id, archived: false }))
    expect(restored.archivedAt).toBeNull()
    // Reversible, and the room is the same row: archiving is a state, not a deletion.
    expect(restored.id).toBe(room.id)
  })

  it("refuses a room from another organization with the same error as a missing one", async () => {
    const room = await runAs(alice, CreateRoom({ name: "Ours" }))
    /*
     * Deliberately indistinguishable: telling a caller "that exists but is not yours" would let them enumerate
     * room ids across tenants by watching which error comes back.
     */
    expect((await failureOf(other, ArchiveRoom({ roomId: room.id, archived: true })))._tag).toBe("RoomNotFound")
  })
})

describe("ResolveRoom", () => {
  it("survives two callers creating the same decision thread at once", async () => {
    const ref = { _tag: "RoomForDecision" as const, decisionId: "dec_race" }

    /*
     * The race the partial unique index exists for. Both calls find nothing and both insert; one wins, the other
     * conflicts, does nothing, and re-reads. Both must end up with the SAME room — a second room here is half a
     * conversation that nobody can see from the other half.
     */
    const [first, second] = await Promise.all([
      runAs(alice, ResolveRoom(ref, { create: true })),
      runAs(alice, ResolveRoom(ref, { create: true }))
    ])

    expect(first?.id).toBeDefined()
    expect(second?.id).toBe(first?.id)

    const rows = await asAdmin(Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      return yield* sql<{ count: string }>`
        select count(*)::text as count from rooms
         where organization_id = ${ORG_A} and subject_id = 'dec_race'
      `
    }))
    expect(rows[0]?.count).toBe("1")
  })
})

describe("unread counts", () => {
  it("counts what somebody else said and you have not read", async () => {
    const room = await runAs(alice, CreateRoom({ name: "Billing" }))
    const ref = { _tag: "RoomById" as const, roomId: room.id }

    await runAs(bob, PostMessage({ room: ref, body: "one" }))
    await runAs(bob, PostMessage({ room: ref, body: "two" }))

    expect((await runAs(alice, ListRooms()))[0]?.unreadCount).toBe(2)
    /*
     * Never your own. You have read what you wrote, and a badge that counted your own messages would make
     * posting feel like falling behind.
     */
    expect((await runAs(bob, ListRooms()))[0]?.unreadCount).toBe(0)
  })

  it("clears as far as the marker, and no further", async () => {
    const room = await runAs(alice, CreateRoom({ name: "Billing" }))
    const ref = { _tag: "RoomById" as const, roomId: room.id }

    await runAs(bob, PostMessage({ room: ref, body: "one" }))
    const second = await runAs(bob, PostMessage({ room: ref, body: "two" }))
    await runAs(bob, PostMessage({ room: ref, body: "three" }))

    await runAs(alice, MarkRead({ roomId: room.id, messageId: second.id }))
    // Inclusive of the marker, exclusive of everything after: `id >` is the same predicate the cursor uses.
    expect((await runAs(alice, ListRooms()))[0]?.unreadCount).toBe(1)
  })

  it("never moves the marker backwards", async () => {
    const room = await runAs(alice, CreateRoom({ name: "Billing" }))
    const ref = { _tag: "RoomById" as const, roomId: room.id }

    const first = await runAs(bob, PostMessage({ room: ref, body: "one" }))
    const third = await runAs(bob, PostMessage({ room: ref, body: "two" }))

    await runAs(alice, MarkRead({ roomId: room.id, messageId: third.id }))
    /*
     * A client that scrolled up, or a late response arriving after a newer one, must not re-unread what was
     * already seen. `greatest` over TEXT does that because UUIDv7 in hex sorts in time order — the same property
     * the keyset cursor relies on, which is why both break together if ids ever stop being time-ordered.
     */
    const result = await runAs(alice, MarkRead({ roomId: room.id, messageId: first.id }))
    expect(result.lastReadMessageId).toBe(third.id)
    expect((await runAs(alice, ListRooms()))[0]?.unreadCount).toBe(0)
  })

  it("treats a channel nobody has opened as entirely unread", async () => {
    const room = await runAs(alice, CreateRoom({ name: "Billing" }))
    await runAs(bob, PostMessage({ room: { _tag: "RoomById", roomId: room.id }, body: "hello" }))

    // A LEFT join, so no marker means "read none of it" rather than "read all of it".
    expect((await runAs(alice, ListRooms()))[0]?.unreadCount).toBe(1)
  })

  it("refuses to mark a room from another organization", async () => {
    const room = await runAs(alice, CreateRoom({ name: "Ours" }))
    const message = await runAs(alice, PostMessage({ room: { _tag: "RoomById", roomId: room.id }, body: "ours" }))
    /*
     * Checked before the insert, so this is a refusal rather than a foreign-key violation surfacing as a 500.
     */
    expect((await failureOf(other, MarkRead({ roomId: room.id, messageId: message.id })))._tag).toBe("RoomNotFound")
  })
})
