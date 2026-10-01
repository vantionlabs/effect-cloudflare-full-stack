/**
 * The quote flow against real Postgres, with a scripted model: request -> draft -> approve -> send.
 *
 * What is asserted is the human boundary and the money, because those are what a quote can get wrong in a way a
 * customer sees: a price that did not come from the price list, a quote sent that nobody approved, the same
 * quote emailed twice, or one marked sent when the email never left.
 */
import { Db } from "@ea/database/Database"
import { CurrentOrg, CurrentUser, Identity, OrgId, UserId } from "@ea/domain/Identity"
import { UpsertProduct } from "@ea/modules/sales/use-cases/Product"
import { ApproveQuote, DraftQuote, GetQuote, SendQuote } from "@ea/modules/sales/use-cases/Quote"
import { Email, type EmailMessage } from "@ea/modules/shared/domain/Email"
import { EmailNotSent } from "@ea/modules/shared/domain/Errors"
import { IdsUuid } from "@ea/modules/shared/server/Ids"
import { PgClient } from "@effect/sql-pg"
import { Effect, type Exit, Layer, Redacted, Stream } from "effect"
import { LanguageModel } from "effect/ai"
import { SqlClient } from "effect/sql"
import { beforeEach, describe, expect, it } from "vitest"

const ORG = OrgId.make("sales_org")
const OTHER = OrgId.make("sales_other_org")

const Admin = PgClient.layer({
  host: process.env["PGHOST"] ?? "localhost",
  port: Number(process.env["PGPORT"] ?? 55433),
  username: process.env["PGUSER"] ?? "effect_ai",
  password: Redacted.make(process.env["PGPASSWORD"] ?? "local_dev_only"),
  database: process.env["PGDATABASE"] ?? "effect_ai",
  ssl: false
})

const REQUEST = "Goedemiddag, graag een offerte voor 3 stuks hydrauliekslang 12mm en 1 overdrukventiel 350 bar. " +
  "Met vriendelijke groet, Piet Smit (piet@smit-transport.nl)"

/** Answers like a model that read the request correctly, and reports usage the way the real adapter does. */
const scriptedReader = Layer.effect(LanguageModel.LanguageModel)(
  LanguageModel.make({
    generateText: () =>
      Effect.succeed([
        { type: "response-metadata" as const, modelId: "reader-model" },
        {
          type: "text" as const,
          text: JSON.stringify({
            customer_name: "Piet Smit",
            customer_email: "piet@smit-transport.nl",
            items: [
              { request_text: "3 stuks hydrauliekslang 12mm", quantity_text: "3", sku: "HS-12" },
              { request_text: "1 overdrukventiel 350 bar", quantity_text: "1", sku: "SV-350" }
            ]
          })
        },
        {
          type: "finish" as const,
          reason: "stop" as const,
          usage: { inputTokens: { total: 400 }, outputTokens: { total: 90 } }
        }
      ]),
    streamText: () => Stream.die(new Error("not used"))
  })
)

const capture = (fail = false) => {
  const sent: Array<EmailMessage> = []
  const layer = Layer.succeed(Email)({
    send: (message) =>
      fail
        ? Effect.fail(new EmailNotSent({ to: message.to, reason: "provider down" }))
        : Effect.sync(() => void sent.push(message))
  })
  return { sent, layer }
}

const as = (orgId: OrgId) =>
  new Identity({ userId: UserId.make("sales_user"), orgId, email: "s@example.com", role: "reviewer" })

const run = <A, E>(
  effect: Effect.Effect<A, E, any>,
  options: { readonly orgId?: OrgId; readonly email?: Layer.Layer<Email> } = {}
) =>
  Effect.runPromise(
    Effect.exit(effect).pipe(
      Effect.provideService(CurrentUser, as(options.orgId ?? ORG)),
      // As the API edge does: the tenant comes from the session (`serveForTenant`).
      Effect.provideService(CurrentOrg, options.orgId ?? ORG),
      Effect.provide(
        Layer.mergeAll(Db.layer, IdsUuid, scriptedReader, options.email ?? capture().layer).pipe(
          Layer.provideMerge(Admin)
        )
      )
    ) as Effect.Effect<Exit.Exit<A, E>, never, never>
  )

const ok = async <A, E>(effect: Effect.Effect<A, E, any>, options?: Parameters<typeof run>[1]) => {
  const exit = await run(effect, options)
  if (exit._tag === "Failure") throw new Error(`expected success, got ${JSON.stringify(exit.cause)}`)
  return exit.value
}

const failureTag = async <A, E>(effect: Effect.Effect<A, E, any>, options?: Parameters<typeof run>[1]) => {
  const exit = await run(effect, options)
  if (exit._tag === "Success") return "Success"
  const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail") as
    | { error?: { _tag?: string } }
    | undefined
  return failure?.error?._tag ?? "Defect"
}

beforeEach(async () => {
  await Effect.runPromise(
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      Effect.gen(function*() {
        for (const org of [ORG, OTHER]) {
          yield* sql`delete from quotes where organization_id = ${org}`
          yield* sql`delete from products where organization_id = ${org}`
          yield* sql`delete from usage_records where organization_id = ${org}`
          yield* sql`delete from organization where id = ${org}`
        }
        yield* sql`insert into organization (id, name, slug, "createdAt") values (${ORG}, 'Acme Hydraulics', ${ORG}, now())`
      })).pipe(Effect.provide(Admin)) as Effect.Effect<void, never, never>
  )
  await ok(
    UpsertProduct({
      sku: "HS-12",
      name: "Hydraulic hose 12 mm",
      unit: "piece",
      unitPrice: 4_250,
      vat: 210,
      active: true
    })
  )
  await ok(
    UpsertProduct({
      sku: "SV-350",
      name: "Relief valve 350 bar",
      unit: "piece",
      unitPrice: 18_900,
      vat: 210,
      active: true
    })
  )
})

describe("a quote, from request to customer", () => {
  it("is drafted from the request with prices from the price list and its reading cost metered", async () => {
    const quote = await ok(DraftQuote({ request: REQUEST }))
    expect(quote.status).toBe("draft")
    expect(quote.customerEmail).toBe("piet@smit-transport.nl")
    expect(quote.lines.map((line) => [line.sku, line.lineTotal])).toEqual([["HS-12", 12_750], ["SV-350", 18_900]])
    expect(quote.total).toBe(quote.subtotal + quote.vatTotal)
    expect(quote.flags).toEqual([])

    const usage = await Effect.runPromise(
      Effect.flatMap(SqlClient.SqlClient, (sql) =>
        sql<{ meter: string; total: number }>`
        select meter, sum(quantity)::int as total from usage_records where organization_id = ${ORG}
         group by meter order by meter
      `).pipe(Effect.provide(Admin)) as Effect.Effect<ReadonlyArray<{ meter: string; total: number }>, never, never>
    )
    expect(usage).toEqual([{ meter: "model.input_tokens", total: 400 }, { meter: "model.output_tokens", total: 90 }])
  })

  it("cannot be sent before a person approves it", async () => {
    const quote = await ok(DraftQuote({ request: REQUEST }))
    const email = capture()
    expect(await failureTag(SendQuote(quote.id), { email: email.layer })).toBe("QuoteNotInState")
    expect(email.sent).toEqual([])
  })

  it("is approved once: a second approval is refused, not repeated", async () => {
    const quote = await ok(DraftQuote({ request: REQUEST }))
    expect((await ok(ApproveQuote(quote.id))).approvedBy).toBe("sales_user")
    expect(await failureTag(ApproveQuote(quote.id))).toBe("QuoteNotInState")
  })

  it("is emailed to the customer once, and a second send is refused", async () => {
    const quote = await ok(DraftQuote({ request: REQUEST }))
    await ok(ApproveQuote(quote.id))
    const email = capture()
    const sent = await ok(SendQuote(quote.id), { email: email.layer })
    expect(sent.status).toBe("sent")
    expect(email.sent).toHaveLength(1)
    expect(email.sent[0]!.to).toBe("piet@smit-transport.nl")
    expect(email.sent[0]!.text).toContain("Totaal:")
    expect(await failureTag(SendQuote(quote.id), { email: email.layer })).toBe("QuoteNotInState")
    expect(email.sent).toHaveLength(1)
  })

  it("stays approved — not falsely marked sent — when the email fails, so it can be sent again", async () => {
    const quote = await ok(DraftQuote({ request: REQUEST }))
    await ok(ApproveQuote(quote.id))
    expect(await failureTag(SendQuote(quote.id), { email: capture(true).layer })).toBe("EmailNotSent")
    expect((await ok(GetQuote(quote.id))).status).toBe("approved")
  })

  it("is invisible to another organization", async () => {
    const quote = await ok(DraftQuote({ request: REQUEST }))
    expect(await failureTag(GetQuote(quote.id), { orgId: OTHER })).toBe("QuoteNotFound")
    expect(await failureTag(ApproveQuote(quote.id), { orgId: OTHER })).toBe("QuoteNotFound")
  })
})

describe("the price list", () => {
  it("refuses a VAT rate that does not exist", async () => {
    expect(
      await failureTag(UpsertProduct({ sku: "X", name: "X", unit: "piece", unitPrice: 100, vat: 190, active: true }))
    ).toBe("InvalidProduct")
  })
})
