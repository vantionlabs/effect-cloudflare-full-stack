/**
 * Email → draft quote against real Postgres, with a scripted model and a recording queue.
 *
 * What is asserted is what a customer or an operator would notice going wrong: a request that vanished, the same
 * email drafted twice, an out-of-office answered with a quote, a burst of mail read without limit, an address that
 * keeps working after it was rotated — and a token that reaches another organization's inbox.
 */
import { Db } from "@ea/database/Database"
import { CurrentOrg, CurrentUser, Identity, type MemberRole, OrgId, UserId } from "@ea/domain/Identity"
import { MAX_INBOUND_PER_HOUR } from "@ea/modules/sales/domain/Inbound"
import {
  DraftFromEmail,
  GetInboundAddress,
  ListInboundMessages,
  type ReceivedEmail,
  ReceiveEmail,
  ResolveInboundToken,
  RotateInboundAddress
} from "@ea/modules/sales/use-cases/Inbound"
import { UpsertProduct } from "@ea/modules/sales/use-cases/Product"
import { ApproveQuote, GetQuote, SendQuote } from "@ea/modules/sales/use-cases/Quote"
import { Email, type EmailMessage } from "@ea/modules/shared/domain/Email"
import { EventBus, type QueueMessage } from "@ea/modules/shared/domain/Event"
import { IdsUuid } from "@ea/modules/shared/server/Ids"
import { PgClient } from "@effect/sql-pg"
import { Effect, type Exit, Layer, Redacted, Stream } from "effect"
import { LanguageModel } from "effect/ai"
import { SqlClient } from "effect/sql"
import { beforeEach, describe, expect, it } from "vitest"

const ORG = OrgId.make("inbound_org")
const OTHER = OrgId.make("inbound_other_org")

const Admin = PgClient.layer({
  host: process.env["PGHOST"] ?? "localhost",
  port: Number(process.env["PGPORT"] ?? 55433),
  username: process.env["PGUSER"] ?? "effect_ai",
  password: Redacted.make(process.env["PGPASSWORD"] ?? "local_dev_only"),
  database: process.env["PGDATABASE"] ?? "effect_ai",
  ssl: false
})

/** Reads the request correctly. The body names no email address: the sender's comes from the envelope. */
const scriptedReader = Layer.effect(LanguageModel.LanguageModel)(
  LanguageModel.make({
    generateText: () =>
      Effect.succeed([
        { type: "response-metadata" as const, modelId: "reader-model" },
        {
          type: "text" as const,
          text: JSON.stringify({
            customer_name: null,
            customer_email: null,
            items: [{ request_text: "2 overdrukventielen 350 bar", quantity_text: "2", sku: "SV-350" }]
          })
        },
        {
          type: "finish" as const,
          reason: "stop" as const,
          usage: { inputTokens: { total: 300 }, outputTokens: { total: 60 } }
        }
      ]),
    streamText: () => Stream.die(new Error("not used"))
  })
)

const queued: Array<QueueMessage> = []
const sentEmails: Array<EmailMessage> = []
const Fakes = Layer.mergeAll(
  Layer.succeed(EventBus)({ send: (message) => Effect.sync(() => void queued.push(message)) }),
  Layer.succeed(Email)({ send: (message) => Effect.sync(() => void sentEmails.push(message)) })
)

const person = (orgId: OrgId, role: MemberRole) =>
  new Identity({ userId: UserId.make(`inbound_${role}`), orgId, email: `${role}@example.com`, role })

/** As a signed-in person (the RPC edge), or — with `role: null` — as the queue/email handler: a tenant, no user. */
const run = <A, E>(effect: Effect.Effect<A, E, any>, orgId: OrgId = ORG, role: MemberRole | null = "owner") => {
  const withTenant = Effect.provideService(Effect.exit(effect), CurrentOrg, orgId)
  const withUser = role === null ? withTenant : Effect.provideService(withTenant, CurrentUser, person(orgId, role))
  return Effect.runPromise(
    withUser.pipe(
      Effect.provide(Layer.mergeAll(Db.layer, IdsUuid, scriptedReader, Fakes).pipe(Layer.provideMerge(Admin)))
    ) as Effect.Effect<Exit.Exit<A, E>, never, never>
  )
}
const ok = async <A, E>(effect: Effect.Effect<A, E, any>, orgId?: OrgId, role?: MemberRole | null) => {
  const exit = await run(effect, orgId, role)
  if (exit._tag === "Failure") throw new Error(`expected success, got ${JSON.stringify(exit.cause)}`)
  return exit.value
}
const failureTag = async <A, E>(effect: Effect.Effect<A, E, any>, orgId?: OrgId, role?: MemberRole | null) => {
  const exit = await run(effect, orgId, role)
  if (exit._tag === "Success") return "Success"
  const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail") as
    | { error?: { _tag?: string } }
    | undefined
  return failure?.error?._tag ?? "Defect"
}
const asAdmin = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(Admin)) as Effect.Effect<A, never, never>)

const email = (overrides: Partial<ReceivedEmail> = {}): ReceivedEmail => ({
  messageId: `<${Math.random().toString(36).slice(2)}@mail.smit.nl>`,
  fromAddress: "Piet@Smit.nl",
  fromName: "Piet Smit",
  subject: "Offerte kleppen",
  text: "Goedemiddag, graag 2 overdrukventielen 350 bar. Groet, Piet",
  autoSubmitted: null,
  precedence: null,
  ...overrides
})

beforeEach(async () => {
  queued.length = 0
  sentEmails.length = 0
  await asAdmin(Effect.flatMap(SqlClient.SqlClient, (sql) =>
    Effect.gen(function*() {
      for (const org of [ORG, OTHER]) {
        yield* sql`delete from quote_lines where organization_id = ${org}`
        yield* sql`delete from quotes where organization_id = ${org}`
        yield* sql`delete from inbound_messages where organization_id = ${org}`
        yield* sql`delete from inbound_addresses where organization_id = ${org}`
        yield* sql`delete from events where organization_id = ${org}`
        yield* sql`delete from products where organization_id = ${org}`
        yield* sql`delete from usage_records where organization_id = ${org}`
        yield* sql`delete from organization where id = ${org}`
      }
      yield* sql`insert into organization (id, name, slug, "createdAt") values (${ORG}, 'Smit Hydrauliek', ${ORG}, now())`
    })))
  await ok(
    UpsertProduct({
      sku: "SV-350",
      name: "Overdrukventiel 350 bar",
      unit: "piece",
      unitPrice: 18_900,
      vat: 210,
      active: true
    })
  )
})

describe("the receiving address", () => {
  it("is created and rotated by an owner, and the old token stops resolving at once", async () => {
    const first = await ok(RotateInboundAddress("offerte.example.nl"))
    expect(first.address).toBe(`${first.token}@offerte.example.nl`)
    expect(first.token).toMatch(/^[0-9a-z]{10}$/)
    expect(await ok(ResolveInboundToken(first.token), ORG, null)).toBe(ORG)

    const second = await ok(RotateInboundAddress(null))
    expect(second.address).toBeNull()
    expect(await ok(ResolveInboundToken(first.token), ORG, null)).toBeNull()
    expect(await ok(ResolveInboundToken(second.token.toUpperCase()), ORG, null)).toBe(ORG)
    expect((await ok(GetInboundAddress(null)))?.token).toBe(second.token)
  })

  it("cannot be created or rotated by a reviewer", async () => {
    expect(await failureTag(RotateInboundAddress(null), ORG, "reviewer")).toBe("InboundAddressForbidden")
  })

  it("never resolves to another organization, and an unknown token resolves to nothing", async () => {
    const mine = await ok(RotateInboundAddress(null))
    expect(await ok(ResolveInboundToken(mine.token), OTHER, null)).toBe(ORG)
    expect(await ok(ResolveInboundToken("zzzzzzzzzz"), ORG, null)).toBeNull()
    expect(await ok(GetInboundAddress(null), OTHER, "owner")).toBeNull()
  })
})

describe("an email to that address", () => {
  it("becomes a draft quote addressed to the sender, linked to the message, and replied to in the same thread", async () => {
    const received = await ok(ReceiveEmail(email({ messageId: "<abc@mail.smit.nl>" })), ORG, null)
    expect(received._tag).toBe("Queued")
    expect(queued.map((message) => message.type)).toEqual(["quote.draft-from-email"])

    const drafted = await ok(
      DraftFromEmail(received._tag === "Queued" ? received.inboundMessageId : ""),
      ORG,
      null
    )
    expect(drafted._tag).toBe("Drafted")
    const quoteId = drafted._tag === "Drafted" ? drafted.quoteId : ""
    const quote = await ok(GetQuote(quoteId))
    expect(quote.customerEmail).toBe("piet@smit.nl")
    expect(quote.customerName).toBe("Piet Smit")
    expect(quote.source?.subject).toBe("Offerte kleppen")
    expect(quote.lines.map((line) => line.sku)).toEqual(["SV-350"])

    const [inbox] = await ok(ListInboundMessages)
    expect(inbox).toMatchObject({ status: "drafted", quoteId })

    await ok(ApproveQuote(quoteId))
    await ok(SendQuote(quoteId))
    expect(sentEmails).toHaveLength(1)
    expect(sentEmails[0]).toMatchObject({
      to: "piet@smit.nl",
      subject: "Re: Offerte kleppen",
      headers: { "In-Reply-To": "<abc@mail.smit.nl>", References: "<abc@mail.smit.nl>" }
    })
  })

  it("is drafted once: a second delivery of the event makes no model call and no second quote", async () => {
    const received = await ok(ReceiveEmail(email()), ORG, null)
    const id = received._tag === "Queued" ? received.inboundMessageId : ""
    await ok(DraftFromEmail(id), ORG, null)
    expect((await ok(DraftFromEmail(id), ORG, null))._tag).toBe("AlreadyHandled")
    const [{ count }] = await asAdmin(
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) => sql<{ count: number }>`select count(*)::integer as count from quotes where organization_id = ${ORG}`
      )
    )
    expect(count).toBe(1)
  })

  it("is ignored when the same Message-ID arrives again", async () => {
    const message = email({ messageId: "<same@mail.smit.nl>" })
    expect((await ok(ReceiveEmail(message), ORG, null))._tag).toBe("Queued")
    expect((await ok(ReceiveEmail(message), ORG, null))._tag).toBe("Duplicate")
    expect(queued).toHaveLength(1)
  })

  it("is recorded and refused, not drafted, when it is an automatic reply", async () => {
    const outcome = await ok(ReceiveEmail(email({ autoSubmitted: "auto-replied" })), ORG, null)
    expect(outcome._tag).toBe("Rejected")
    expect(queued).toHaveLength(0)
    const [inbox] = await ok(ListInboundMessages)
    expect(inbox?.status).toBe("rejected")
  })

  it(`is refused — and recorded — past ${MAX_INBOUND_PER_HOUR} messages in an hour`, async () => {
    await asAdmin(Effect.flatMap(SqlClient.SqlClient, (sql) =>
      Effect.forEach(
        Array.from({ length: MAX_INBOUND_PER_HOUR }, (_, index) => index),
        (index) =>
          sql`
            insert into inbound_messages (id, organization_id, message_id, from_address, body_text, status)
            values (${`burst-${index}`}, ${ORG}, ${`<burst-${index}@x>`}, 'x@x.nl', 'x', 'received')
          `,
        { discard: true }
      )))
    const outcome = await ok(ReceiveEmail(email()), ORG, null)
    expect(outcome._tag).toBe("Rejected")
    expect(queued).toHaveLength(0)
    const inbox = await ok(ListInboundMessages)
    expect(inbox.filter((message) => message.status === "rejected")).toHaveLength(1)
  })

  it("shows as failed once its drafting event is dead-lettered, instead of 'received' forever", async () => {
    const received = await ok(ReceiveEmail(email()), ORG, null)
    const id = received._tag === "Queued" ? received.inboundMessageId : ""
    expect((await ok(ListInboundMessages))[0]?.status).toBe("received")
    await asAdmin(
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) =>
          sql`update events set status = 'dead' where organization_id = ${ORG} and idempotency_key = ${`quote-email:${id}`}`
      )
    )
    const [message] = await ok(ListInboundMessages)
    expect(message?.status).toBe("failed")
    expect(message?.reason).toContain("niet gelezen")
  })

  it("is invisible to another organization", async () => {
    await ok(ReceiveEmail(email()), ORG, null)
    expect(await ok(ListInboundMessages, OTHER, "owner")).toEqual([])
  })
})
