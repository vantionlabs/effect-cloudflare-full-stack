/**
 * Asking the organization's data, against real Postgres, with a scripted model.
 *
 * The model is scripted so the test controls what it SAYS; the tools, the SQL and the figure check are real. That
 * isolates the property that matters: a grounded answer is returned, a computed figure is withheld — and in both
 * cases the data the tools returned reaches the person.
 */
import { Db } from "@ea/database/Database"
import { CurrentOrg, OrgId } from "@ea/domain/Identity"
import { AskData, dataToolkitFor } from "@ea/modules/reporting/use-cases/DataAsk"
import { PgClient } from "@effect/sql-pg"
import { Effect, Layer, Redacted, Stream } from "effect"
import { LanguageModel } from "effect/ai"
import { SqlClient } from "effect/sql"
import { beforeEach, describe, expect, it } from "vitest"

const ORG = OrgId.make("ask_data_org")

const Admin = PgClient.layer({
  host: process.env["PGHOST"] ?? "localhost",
  port: Number(process.env["PGPORT"] ?? 55433),
  username: process.env["PGUSER"] ?? "effect_ai",
  password: Redacted.make(process.env["PGPASSWORD"] ?? "local_dev_only"),
  database: process.env["PGDATABASE"] ?? "effect_ai",
  ssl: false
})

/** Calls `quote_figures` for September, then says `answer`. */
const scripted = (answer: string) => {
  let call = 0
  return Layer.effect(LanguageModel.LanguageModel)(
    LanguageModel.make({
      generateText: () =>
        Effect.sync(() => {
          call++
          return call === 1
            ? [{
              type: "tool-call" as const,
              id: "c1",
              name: "quote_figures",
              params: { from: "2026-09-01", to: "2026-10-01" }
            }]
            : [{ type: "text" as const, text: answer }]
        }),
      streamText: () => Stream.die(new Error("not used"))
    })
  )
}

const ask = (answer: string) =>
  Effect.runPromise(
    AskData("How many quotes did we send in September, and for how much?").pipe(
      // One provide: the toolkit needs the tenant and the connection, and the loop needs the model and the toolkit.
      Effect.provide(
        dataToolkitFor.pipe(
          Layer.provideMerge(
            Layer.mergeAll(scripted(answer), Layer.succeed(CurrentOrg)(ORG), Db.layer.pipe(Layer.provideMerge(Admin)))
          )
        )
      ),
      Effect.orDie
    )
  )

beforeEach(async () => {
  await Effect.runPromise(
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      Effect.gen(function*() {
        yield* sql`delete from quotes where organization_id = ${ORG}`
        for (
          const [id, status, total, at] of [
            ["ad_q1", "sent", 45_738, "2026-09-10T10:00:00Z"],
            ["ad_q2", "sent", 137_214, "2026-09-20T10:00:00Z"],
            ["ad_q3", "draft", 10_000, "2026-09-25T10:00:00Z"],
            ["ad_q4", "sent", 99_999, "2026-08-31T10:00:00Z"]
          ] as const
        ) {
          yield* sql`
          insert into quotes (id, organization_id, status, request, subtotal_cents, vat_total_cents, total_cents,
                              created_by, created_at)
          values (${id}, ${ORG}, ${status}, 'r', ${total}, 0, ${total}, 'u', ${at}::timestamptz)
        `
        }
      })).pipe(Effect.provide(Admin)) as Effect.Effect<void, never, never>
  )
})

describe("asking the data", () => {
  it("returns an answer whose figures all come from the data, with the data itself", async () => {
    const result = await ask("In September 2026 we sent 2 quotes, worth € 1.829,52 in total.")
    expect(result.answer).toContain("2 quotes")
    expect(result.refusedFigures).toEqual([])
    // The real SQL counted only September's two sent quotes — not August's.
    const figures = result.data[0]!.result as { quotes_by_status: { sent: { count: number; value_eur: string } } }
    expect(figures.quotes_by_status.sent).toEqual({ count: 2, value_eur: "1829.52" })
  })

  it("withholds an answer with a figure the model computed, and still returns the data", async () => {
    // 1829.52 / 2 = 914.76 — true, but computed, so not traceable to anything the tools returned.
    const result = await ask("We sent 2 quotes, an average of € 914,76 each.")
    expect(result.answer).toBeNull()
    expect(result.refusedFigures).toEqual(["91476"])
    expect(result.data).toHaveLength(1)
  })
})
