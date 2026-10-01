/**
 * Changing the price list by asking, against real Postgres, with a scripted model whose tool calls the test sets.
 *
 * The properties are the human gate and the truth of the diff: a proposal changes nothing; a value the instruction
 * did not contain is refused; applying writes exactly what was proposed, once; and a proposal made against a
 * product that has since changed is refused rather than silently overwriting the newer change.
 */
import { Db } from "@ea/database/Database"
import { CurrentUser, Identity, OrgId, UserId } from "@ea/domain/Identity"
import { ApplyChange, changeToolkitFor, ProposeChanges, RejectChange } from "@ea/modules/sales/use-cases/Change"
import { ListProducts, UpsertProduct } from "@ea/modules/sales/use-cases/Product"
import { IdsUuid } from "@ea/modules/shared/server/Ids"
import { PgClient } from "@effect/sql-pg"
import { Effect, type Exit, Layer, Redacted, Stream } from "effect"
import { LanguageModel } from "effect/ai"
import { SqlClient } from "effect/sql"
import { beforeEach, describe, expect, it } from "vitest"

const ORG = OrgId.make("change_org")

const Admin = PgClient.layer({
  host: process.env["PGHOST"] ?? "localhost",
  port: Number(process.env["PGPORT"] ?? 55433),
  username: process.env["PGUSER"] ?? "effect_ai",
  password: Redacted.make(process.env["PGPASSWORD"] ?? "local_dev_only"),
  database: process.env["PGDATABASE"] ?? "effect_ai",
  ssl: false
})

const Base = Layer.mergeAll(Db.layer, IdsUuid).pipe(Layer.provideMerge(Admin))
const user = new Identity({ userId: UserId.make("changer"), orgId: ORG, email: "c@example.com", role: "reviewer" })

const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
  Effect.runPromise(
    Effect.exit(effect).pipe(Effect.provideService(CurrentUser, user), Effect.provide(Base)) as Effect.Effect<
      Exit.Exit<A, E>,
      never,
      never
    >
  )

const ok = async <A, E>(effect: Effect.Effect<A, E, any>) => {
  const exit = await run(effect)
  if (exit._tag === "Failure") throw new Error(JSON.stringify(exit.cause))
  return exit.value
}

const tag = async <A, E>(effect: Effect.Effect<A, E, any>) => {
  const exit = await run(effect)
  if (exit._tag === "Success") return "Success"
  const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail") as
    | { error?: { _tag?: string } }
    | undefined
  return failure?.error?._tag ?? "Defect"
}

/** A model that makes exactly the given tool calls, then stops. */
const scripted = (calls: ReadonlyArray<{ name: string; params: Record<string, unknown> }>) => {
  let step = 0
  return Layer.effect(LanguageModel.LanguageModel)(
    LanguageModel.make({
      generateText: () =>
        Effect.sync(() => {
          step++
          return step === 1
            ? calls.map((call, index) => ({ type: "tool-call" as const, id: `c${index}`, ...call }))
            : [{ type: "text" as const, text: "Done." }]
        }),
      streamText: () => Stream.die(new Error("not used"))
    })
  )
}

const propose = (instruction: string, calls: ReadonlyArray<{ name: string; params: Record<string, unknown> }>) =>
  ok(
    ProposeChanges(instruction).pipe(
      Effect.provide(changeToolkitFor(instruction).pipe(Layer.provideMerge(scripted(calls))))
    )
  )

const priceOf = async (sku: string) => (await ok(ListProducts({ includeInactive: true }))).find((p) => p.sku === sku)

beforeEach(async () => {
  await Effect.runPromise(
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      Effect.gen(function*() {
        yield* sql`delete from change_proposals where organization_id = ${ORG}`
        yield* sql`delete from products where organization_id = ${ORG}`
      })).pipe(Effect.provide(Admin)) as Effect.Effect<void, never, never>
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

describe("changing the price list by asking", () => {
  const RAISE = "Raise SV-350 to 199 euro."

  it("proposes the exact before and after, and changes nothing until a person applies it", async () => {
    const run = await propose(RAISE, [{ name: "propose_product_change", params: { sku: "SV-350", price_eur: "199" } }])
    expect(run.refusals).toEqual([])
    expect(run.proposals).toHaveLength(1)
    const change = run.proposals[0]!
    expect(change.status).toBe("pending")
    expect([change.before?.unitPrice, change.after.unitPrice]).toEqual([18_900, 19_900])
    expect((await priceOf("SV-350"))?.unitPrice).toBe(18_900)

    expect((await ok(ApplyChange(change.id))).status).toBe("applied")
    expect((await priceOf("SV-350"))?.unitPrice).toBe(19_900)
    expect(await tag(ApplyChange(change.id))).toBe("ChangeNotPending")
  })

  it("makes ONE proposal however many times the model asks for the same change", async () => {
    // The real model called the tool four times for one instruction; the page showed four identical proposals.
    const call = { name: "propose_product_change", params: { sku: "SV-350", price_eur: "199" } }
    const first = await propose(RAISE, [call, call, call, call])
    expect(first.proposals).toHaveLength(1)
    // And asking again while it is still pending returns the same proposal, not a second one.
    const again = await propose(RAISE, [call])
    expect(again.proposals.map((p) => p.id)).toEqual(first.proposals.map((p) => p.id))
  })

  it("refuses a price the instruction does not contain", async () => {
    const run = await propose(RAISE, [{ name: "propose_product_change", params: { sku: "SV-350", price_eur: "250" } }])
    expect(run.proposals).toEqual([])
    expect(run.refusals[0]).toContain("not in the instruction")
  })

  it("refuses a change to a product that does not exist", async () => {
    const run = await propose("Raise XX-1 to 10 euro.", [{
      name: "propose_product_change",
      params: { sku: "XX-1", price_eur: "10" }
    }])
    expect(run.refusals[0]).toContain("no product with SKU XX-1")
  })

  it("refuses to apply a proposal the product has moved on from, and leaves it pending", async () => {
    const run = await propose(RAISE, [{ name: "propose_product_change", params: { sku: "SV-350", price_eur: "199" } }])
    // Someone edits the price by hand after the proposal was made.
    await ok(
      UpsertProduct({
        sku: "SV-350",
        name: "Relief valve 350 bar",
        unit: "piece",
        unitPrice: 20_500,
        vat: 210,
        active: true
      })
    )
    expect(await tag(ApplyChange(run.proposals[0]!.id))).toBe("ChangeIsStale")
    expect((await priceOf("SV-350"))?.unitPrice).toBe(20_500)
    // The claim was rolled back with the rest of the transaction: it can still be rejected.
    expect((await ok(RejectChange(run.proposals[0]!.id))).status).toBe("rejected")
  })

  it("proposes and applies a new product", async () => {
    const instruction = "Add KS-01 Seal kit standard at 12,50 per piece, 21% VAT."
    const run = await propose(instruction, [{
      name: "propose_new_product",
      params: { sku: "KS-01", name: "Seal kit standard", unit: "piece", price_eur: "12,50", vat_percent: "21" }
    }])
    expect(run.proposals[0]?.kind).toBe("create_product")
    await ok(ApplyChange(run.proposals[0]!.id))
    expect(await priceOf("KS-01")).toMatchObject({ unitPrice: 1_250, vat: 210, active: true })
  })

  it("can stop offering a product, which deactivates it rather than deleting it", async () => {
    const instruction = "Stop offering SV-350."
    const run = await propose(instruction, [{
      name: "propose_product_change",
      params: { sku: "SV-350", active: false }
    }])
    await ok(ApplyChange(run.proposals[0]!.id))
    expect((await priceOf("SV-350"))?.active).toBe(false)
  })
})
