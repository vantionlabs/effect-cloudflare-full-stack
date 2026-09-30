/**
 * API keys against real Postgres: what is stored, what is refused, and what revocation actually means.
 *
 * The assertions that matter are the negative ones. A key is a bearer credential, so the interesting questions
 * are all about what does NOT work: a revoked key, a key whose member has been removed, a key presented to
 * another organization's data, and the plaintext being unrecoverable after issue.
 */
import { Db } from "@ea/database/Database"
import { CurrentOrg, CurrentUser, Identity, OrgId, UserId } from "@ea/domain/Identity"
import { Ids } from "@ea/domain/Ids"
import { hashApiKey, KEY_PREFIX } from "@ea/modules/iam/domain/ApiKey"
import { IssueApiKey, ListApiKeys, ResolveApiKey, RevokeApiKey } from "@ea/modules/iam/use-cases/ApiKey"
import { PgClient } from "@effect/sql-pg"
import { Effect, Layer, Redacted } from "effect"
import { SqlClient } from "effect/sql"
import { beforeEach, describe, expect, it } from "vitest"

const ORG = OrgId.make("key_org")
const OTHER = OrgId.make("key_org_other")
const USER = "key_user"

const Admin = PgClient.layer({
  host: process.env["PGHOST"] ?? "localhost",
  port: Number(process.env["PGPORT"] ?? 55433),
  username: process.env["PGUSER"] ?? "effect_ai",
  password: Redacted.make(process.env["PGPASSWORD"] ?? "local_dev_only"),
  database: process.env["PGDATABASE"] ?? "effect_ai",
  ssl: false
})

let counter = 0
const IdsLive = Layer.succeed(Ids)({
  next: Effect.sync(() => `key_${String(counter++).padStart(4, "0")}`)
})

const identity = new Identity({
  userId: UserId.make(USER),
  orgId: ORG,
  email: "owner@example.test",
  role: "owner"
})

const runAs = <A, E>(who: Identity, effect: Effect.Effect<A, E, any>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provideService(CurrentUser, who),
      Effect.provideService(CurrentOrg, who.orgId),
      Effect.provide(Layer.mergeAll(Db.layer, IdsLive).pipe(Layer.provideMerge(Admin)))
    ) as Effect.Effect<A, E, never>
  )

/** `ResolveApiKey` takes a raw `SqlClient`, because the tenant is what it is discovering. */
const resolve = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(Admin)) as Effect.Effect<A, E, never>)

const asAdmin = resolve

/** better-auth owns `member` and `user`; the tests write them directly, as the worker tests do. */
const seedMember = (organizationId: string, userId: string, role: string) =>
  asAdmin(Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      insert into organization (id, name, slug, "createdAt")
      values (${organizationId}, ${organizationId}, ${organizationId}, now())
      on conflict (id) do nothing
    `
    yield* sql`
      insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      values (${userId}, 'Key User', ${`${userId}@example.test`}, true, now(), now())
      on conflict (id) do nothing
    `
    yield* sql`
      insert into member (id, "organizationId", "userId", role, "createdAt")
      values (${`m_${organizationId}_${userId}`}, ${organizationId}, ${userId}, ${role}, now())
      on conflict (id) do nothing
    `
  }))

beforeEach(async () => {
  counter = 0
  await asAdmin(Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`delete from api_keys where organization_id in (${ORG}, ${OTHER})`
    yield* sql`delete from member where "organizationId" in (${ORG}, ${OTHER})`
    yield* sql`delete from "user" where id in (${USER}, 'key_gone')`
    yield* sql`delete from organization where id in (${ORG}, ${OTHER})`
  }))
  await seedMember(ORG, USER, "owner")
})

describe("IssueApiKey", () => {
  it("returns the plaintext once, and stores only a hash", async () => {
    const issued = await runAs(identity, IssueApiKey({ name: "Laravel" }))

    expect(issued.key.startsWith(KEY_PREFIX)).toBe(true)
    expect(issued.prefix).toBe(issued.key.slice(0, 8))

    // The stored row must not contain the key anywhere in it.
    const rows = await asAdmin(
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) => sql<{ key_hash: string }>`select key_hash from api_keys where id = ${issued.id}`
      )
    )
    expect(rows[0]!.key_hash).toBe(await hashApiKey(issued.key))
    expect(rows[0]!.key_hash).not.toContain(issued.key)
  })

  it("never returns the plaintext again", async () => {
    const issued = await runAs(identity, IssueApiKey({ name: "Once" }))
    const listed = await runAs(identity, ListApiKeys())

    expect(listed).toHaveLength(1)
    expect(JSON.stringify(listed)).not.toContain(issued.key)
    // The display prefix IS returned, which is how a person tells two keys apart.
    expect(listed[0]!.prefix).toBe(issued.prefix)
  })

  it("issues distinct keys", async () => {
    const first = await runAs(identity, IssueApiKey({ name: "a" }))
    const second = await runAs(identity, IssueApiKey({ name: "b" }))
    expect(first.key).not.toBe(second.key)
  })
})

describe("ResolveApiKey", () => {
  it("resolves to the same Identity a session would produce", async () => {
    const issued = await runAs(identity, IssueApiKey({ name: "Laravel" }))
    const resolved = await resolve(ResolveApiKey(issued.key))

    expect(resolved).not.toBeNull()
    expect(resolved!.userId).toBe(USER)
    expect(resolved!.orgId).toBe(ORG)
    expect(resolved!.role).toBe("owner")
  })

  it("accepts a Bearer header as well as a bare key", async () => {
    const issued = await runAs(identity, IssueApiKey({ name: "Bearer" }))
    expect(await resolve(ResolveApiKey(`Bearer ${issued.key}`))).not.toBeNull()
  })

  it("refuses a REVOKED key", async () => {
    const issued = await runAs(identity, IssueApiKey({ name: "Doomed" }))
    await runAs(identity, RevokeApiKey({ apiKeyId: issued.id }))

    expect(await resolve(ResolveApiKey(issued.key))).toBeNull()
  })

  /*
   * The property `acts_as_user_id` exists for: a key has no authority of its own. Removing the member removes
   * the key's access, without anything touching the key's row — which is what makes offboarding one action
   * rather than two.
   */
  it("refuses a key whose member is no longer a member", async () => {
    const issued = await runAs(identity, IssueApiKey({ name: "Orphan" }))
    await asAdmin(
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) => sql`delete from member where "organizationId" = ${ORG} and "userId" = ${USER}`
      )
    )

    expect(await resolve(ResolveApiKey(issued.key))).toBeNull()
  })

  it("refuses a role outside our closed set, rather than granting one nobody defined", async () => {
    // better-auth's own default role is `member`. See .scratch/rest-api/issues/05.
    await seedMember(OTHER, "key_gone", "member")
    const otherIdentity = new Identity({
      userId: UserId.make("key_gone"),
      orgId: OTHER,
      email: "x@example.test",
      role: "owner"
    })
    const issued = await runAs(otherIdentity, IssueApiKey({ name: "Undefined role" }))

    expect(await resolve(ResolveApiKey(issued.key))).toBeNull()
  })

  it("refuses nonsense without hashing it", async () => {
    for (const presented of [null, undefined, "", "not-a-key", "Bearer abc", `${KEY_PREFIX}short`]) {
      expect(await resolve(ResolveApiKey(presented))).toBeNull()
    }
  })

  it("records last_used_at, so a key can be retired safely", async () => {
    const issued = await runAs(identity, IssueApiKey({ name: "Used" }))
    expect((await runAs(identity, ListApiKeys()))[0]!.lastUsedAt).toBeNull()

    await resolve(ResolveApiKey(issued.key))
    expect((await runAs(identity, ListApiKeys()))[0]!.lastUsedAt).not.toBeNull()
  })
})

describe("RevokeApiKey", () => {
  it("is idempotent and does not move the timestamp", async () => {
    const issued = await runAs(identity, IssueApiKey({ name: "Twice" }))
    await runAs(identity, RevokeApiKey({ apiKeyId: issued.id }))
    const first = (await runAs(identity, ListApiKeys()))[0]!.revokedAt

    await runAs(identity, RevokeApiKey({ apiKeyId: issued.id }))
    // The moment a key stopped working is a fact about the past.
    expect((await runAs(identity, ListApiKeys()))[0]!.revokedAt).toBe(first)
  })

  it("returns null for an id in another organization, so revoking cannot reach across", async () => {
    await seedMember(OTHER, "key_gone", "owner")
    const otherIdentity = new Identity({
      userId: UserId.make("key_gone"),
      orgId: OTHER,
      email: "x@example.test",
      role: "owner"
    })
    const theirs = await runAs(otherIdentity, IssueApiKey({ name: "Theirs" }))

    expect(await runAs(identity, RevokeApiKey({ apiKeyId: theirs.id }))).toBeNull()
    // And it is still usable, which is the point of the assertion above.
    expect(await resolve(ResolveApiKey(theirs.key))).not.toBeNull()
  })

  it("does not list another organization's keys", async () => {
    await seedMember(OTHER, "key_gone", "owner")
    const otherIdentity = new Identity({
      userId: UserId.make("key_gone"),
      orgId: OTHER,
      email: "x@example.test",
      role: "owner"
    })
    await runAs(otherIdentity, IssueApiKey({ name: "Hidden" }))

    expect(await runAs(identity, ListApiKeys())).toEqual([])
  })
})
