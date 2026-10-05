/**
 * The conversation INDEX against real Postgres: a person sees their own conversations in their active organization,
 * newest first — and never another organization's, nor a colleague's.
 */
import { Db } from "@ea/database/Database"
import { CurrentUser, Identity, OrgId, UserId } from "@ea/domain/Identity"
import {
  ArchiveConversation,
  ListConversations,
  RenameConversation,
  touchConversation
} from "@ea/modules/policy/use-cases/Assistant"
import { PgClient } from "@effect/sql-pg"
import { Effect, type Exit, Layer, Redacted } from "effect"
import { SqlClient } from "effect/sql"
import { beforeEach, describe, expect, it } from "vitest"

const ORG_A = OrgId.make("conv_idx_a")
const ORG_B = OrgId.make("conv_idx_b")
const Admin = PgClient.layer({
  host: process.env["PGHOST"] ?? "localhost",
  port: Number(process.env["PGPORT"] ?? 55433),
  username: process.env["PGUSER"] ?? "effect_ai",
  password: Redacted.make(process.env["PGPASSWORD"] ?? "local_dev_only"),
  database: process.env["PGDATABASE"] ?? "effect_ai",
  ssl: false
})
const person = (userId: string, orgId: OrgId) =>
  new Identity({ userId: UserId.make(userId), orgId, email: `${userId}@example.test`, role: "reviewer" })

const as = <A, E>(identity: Identity, effect: Effect.Effect<A, E, unknown>) =>
  Effect.runPromise(
    Effect.exit(effect).pipe(
      Effect.provideService(CurrentUser, identity),
      Effect.provide(Db.layer.pipe(Layer.provideMerge(Admin)))
    ) as Effect.Effect<Exit.Exit<A, E>, never, never>
  ).then((exit) => {
    if (exit._tag === "Failure") throw new Error(JSON.stringify(exit.cause))
    return exit.value
  })

const anna = person("anna", ORG_A)
const bert = person("bert", ORG_A)
const carla = person("carla", ORG_B)

beforeEach(async () => {
  await Effect.runPromise(
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql`delete from assistant_conversations where organization_id in (${ORG_A}, ${ORG_B})`
    ).pipe(
      Effect.provide(Admin)
    ) as Effect.Effect<unknown, never, never>
  )
})

describe("the conversation index", () => {
  it("lists a person's own conversations, newest first, titled by the first question", async () => {
    await as(anna, touchConversation("k1", "Wat is de maximale werkdruk van de PK 23.500?", "knowledge", 1))
    await as(anna, touchConversation("k2", "Hoe vaak moet het filter vervangen worden?", "knowledge", 1))
    // A later turn in k1 moves it to the top and keeps its title.
    await as(anna, touchConversation("k1", "Wat is de maximale werkdruk van de PK 23.500?", "knowledge", 2))
    const list = await as(anna, ListConversations)
    expect(list.map((c) => c.id)).toEqual(["k1", "k2"])
    expect(list[0]!.title).toBe("Wat is de maximale werkdruk van de PK 23.500?")
    expect(list[0]!.turnCount).toBe(2)
  })

  it("never lists another organization's conversations, nor a colleague's", async () => {
    await as(anna, touchConversation("mine", "Vraag van Anna", "knowledge", 1))
    await as(bert, touchConversation("colleague", "Vraag van Bert", "knowledge", 1))
    await as(carla, touchConversation("other-org", "Vraag van Carla", "knowledge", 1))
    expect((await as(anna, ListConversations)).map((c) => c.id)).toEqual(["mine"])
    expect((await as(carla, ListConversations)).map((c) => c.id)).toEqual(["other-org"])
  })

  it("renames and archives only the caller's own conversation", async () => {
    await as(anna, touchConversation("k1", "Eerste vraag", "knowledge", 1))
    expect((await as(anna, RenameConversation("k1", "Werkdruk PK 23.500")))[0]!.title).toBe("Werkdruk PK 23.500")
    // Bert cannot archive Anna's conversation: the update matches no row, and her list is unchanged.
    await as(bert, ArchiveConversation("k1"))
    expect(await as(anna, ListConversations)).toHaveLength(1)
    expect(await as(anna, ArchiveConversation("k1"))).toEqual([])
  })

  it("trims a long first question to a list-sized title", async () => {
    await as(anna, touchConversation("long", "x".repeat(300), "knowledge", 1))
    const [summary] = await as(anna, ListConversations)
    expect(summary!.title.length).toBe(120)
    expect(summary!.title.endsWith("…")).toBe(true)
  })
})
