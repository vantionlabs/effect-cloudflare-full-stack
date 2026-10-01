/**
 * After the sale, against real Postgres: accept -> job -> done -> invoiced -> paid, and the planning view at each
 * step. The properties are that money moves through the stages exactly once and lands in the right place: an
 * accepted quote's value becomes work in progress, a finished job becomes an invoice due after the terms, and a
 * payment takes it out of the forecast.
 */
import { Db } from "@ea/database/Database"
import { CurrentOrg, CurrentUser, Identity, OrgId, UserId } from "@ea/domain/Identity"
import { GetPlanning } from "@ea/modules/reporting/use-cases/Planning"
import {
  CompleteJob,
  InvoiceJob,
  ListInvoices,
  ListJobs,
  RecordPayment,
  RespondToQuote
} from "@ea/modules/sales/use-cases/Work"
import { PAYMENT_TERMS_DAYS } from "@ea/modules/shared/domain/Money"
import { IdsUuid } from "@ea/modules/shared/server/Ids"
import { PgClient } from "@effect/sql-pg"
import { Effect, type Exit, Layer, Redacted } from "effect"
import { SqlClient } from "effect/sql"
import { beforeEach, describe, expect, it } from "vitest"

const ORG = OrgId.make("work_org")
const Admin = PgClient.layer({
  host: process.env["PGHOST"] ?? "localhost",
  port: Number(process.env["PGPORT"] ?? 55433),
  username: process.env["PGUSER"] ?? "effect_ai",
  password: Redacted.make(process.env["PGPASSWORD"] ?? "local_dev_only"),
  database: process.env["PGDATABASE"] ?? "effect_ai",
  ssl: false
})
const user = new Identity({ userId: UserId.make("worker"), orgId: ORG, email: "w@example.com", role: "reviewer" })

const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
  Effect.runPromise(
    Effect.exit(effect).pipe(
      Effect.provideService(CurrentUser, user),
      Effect.provideService(CurrentOrg, ORG),
      Effect.provide(Layer.mergeAll(Db.layer, IdsUuid).pipe(Layer.provideMerge(Admin)))
    ) as Effect.Effect<Exit.Exit<A, E>, never, never>
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

const TODAY = new Date().toISOString().slice(0, 10)
const plusDays = (days: number) =>
  new Date(Date.parse(`${TODAY}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

beforeEach(async () => {
  await Effect.runPromise(
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      Effect.gen(function*() {
        yield* sql`delete from invoices where organization_id = ${ORG}`
        yield* sql`delete from jobs where organization_id = ${ORG}`
        yield* sql`delete from quotes where organization_id = ${ORG}`
        for (const [id, status] of [["wq_sent", "sent"], ["wq_other", "sent"], ["wq_draft", "draft"]]) {
          yield* sql`
          insert into quotes (id, organization_id, status, customer_name, request, subtotal_cents, vat_total_cents,
                              total_cents, created_by)
          values (${id}, ${ORG}, ${status}, 'Piet Smit', 'r', 37_800, 7_938, 45_738, 'u')
        `
        }
      })).pipe(Effect.provide(Admin)) as Effect.Effect<void, never, never>
  )
})

describe("after the sale", () => {
  it("turns an accepted quote into work in progress, then an invoice, then cash", async () => {
    let plan = await ok(GetPlanning)
    expect(plan.pipeline).toEqual({ count: 2, cents: 91_476 })

    expect((await ok(RespondToQuote("wq_sent", true))).status).toBe("accepted")
    const [job] = await ok(ListJobs)
    expect(job).toMatchObject({ status: "open", value: 45_738, customerName: "Piet Smit" })
    plan = await ok(GetPlanning)
    expect(plan.pipeline.count).toBe(1)
    expect(plan.workInProgress.openJobs).toEqual({ count: 1, cents: 45_738 })

    await ok(CompleteJob(job!.id))
    plan = await ok(GetPlanning)
    expect(plan.workInProgress).toMatchObject({ openJobs: { count: 0 }, doneNotInvoiced: { count: 1, cents: 45_738 } })

    await ok(InvoiceJob(job!.id))
    const [invoice] = await ok(ListInvoices)
    expect(invoice).toMatchObject({
      status: "open",
      amount: 45_738,
      issuedOn: TODAY,
      dueOn: plusDays(PAYMENT_TERMS_DAYS)
    })
    plan = await ok(GetPlanning)
    expect(plan.openInvoices).toEqual({ count: 1, cents: 45_738 })
    expect(plan.weeks.reduce((sum, week) => sum + week.fromInvoices, 0)).toBe(45_738)

    expect((await ok(RecordPayment(invoice!.id))).paidOn).toBe(TODAY)
    plan = await ok(GetPlanning)
    expect(plan.openInvoices.count).toBe(0)
    expect(plan.weeks.reduce((sum, week) => sum + week.total, 0)).toBe(0)
  })

  it("refuses every step taken twice or out of order", async () => {
    await ok(RespondToQuote("wq_sent", true))
    expect(await tag(RespondToQuote("wq_sent", false))).toBe("QuoteNotInState")
    expect(await tag(RespondToQuote("wq_draft", true))).toBe("QuoteNotInState")
    const [job] = await ok(ListJobs)
    expect(await tag(InvoiceJob(job!.id))).toBe("JobNotInState") // not finished yet
    await ok(CompleteJob(job!.id))
    expect(await tag(CompleteJob(job!.id))).toBe("JobNotInState")
    await ok(InvoiceJob(job!.id))
    expect(await tag(InvoiceJob(job!.id))).toBe("JobNotInState")
    const [invoice] = await ok(ListInvoices)
    await ok(RecordPayment(invoice!.id))
    expect(await tag(RecordPayment(invoice!.id))).toBe("InvoiceAlreadyPaid")
  })

  it("creates no job when the customer declines", async () => {
    expect((await ok(RespondToQuote("wq_other", false))).status).toBe("declined")
    expect(await ok(ListJobs)).toEqual([])
  })
})
