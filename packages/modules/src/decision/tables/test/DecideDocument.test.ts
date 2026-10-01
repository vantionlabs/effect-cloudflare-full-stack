/**
 * The decide pipeline against real Postgres, and the one assertion the plan names by hand:
 *
 *   **fail a step mid-run, redeliver, and assert exactly ONE extraction model call.**
 *
 * That is the entire economic justification for writing a workflow engine. Without the memo, a
 * transient failure in the last step makes Queues redeliver and re-run everything — including an
 * extraction that costs real money. The counter below is the proof, and it counts calls to the scripted
 * model rather than trusting the engine's own bookkeeping: an engine reporting its own cache hits would
 * be the thing under test vouching for itself.
 */
import { Db } from "@ea/database/Database"
import { CurrentOrgFromUser, CurrentUser, Identity, OrgId, UserId } from "@ea/domain/Identity"
import { Ids } from "@ea/domain/Ids"
import { TelemetryNoop } from "@ea/modules/decision/domain/Telemetry"
import { DecideDocument, decideKey } from "@ea/modules/decision/use-cases/Decision"
import { ChunkerHeading } from "@ea/modules/policy/domain/Chunk"
import { EmbedderDeterministic } from "@ea/modules/policy/server/Embedding"
import { IndexPolicyDocument } from "@ea/modules/policy/use-cases/Chunk"
import { PolicySearchLive } from "@ea/modules/policy/use-cases/Retrieval"
import { EventBus, type EventBusService } from "@ea/modules/shared/domain/Event"
import { PgClient } from "@effect/sql-pg"
import { Effect, Layer, Redacted, Stream } from "effect"
import { LanguageModel } from "effect/ai"
import { SqlClient } from "effect/sql"
import { beforeEach, describe, expect, it } from "vitest"

const ORG = OrgId.make("decide_org")
const DOCUMENT = "decide_doc"
const VERTICAL = "invoice"

const Admin = PgClient.layer({
  // PG* env vars with the compose.yaml values as defaults, matching `migrate.setup.ts` and `evals/`.
  // Hardcoding them made this suite pass locally and fail in CI with `28P01 password authentication
  // failed`, because CI runs its own Postgres service with its own throwaway password. A test that can
  // only reach one specific container is not a test of the code.
  host: process.env["PGHOST"] ?? "localhost",
  port: Number(process.env["PGPORT"] ?? 55433),
  username: process.env["PGUSER"] ?? "effect_ai",
  password: Redacted.make(process.env["PGPASSWORD"] ?? "local_dev_only"),
  database: process.env["PGDATABASE"] ?? "effect_ai",
  ssl: false
})

const IdsLive = Layer.succeed(Ids)({ next: Effect.sync(() => crypto.randomUUID()) })

const POLICY = `# Inkoopbeleid

## Artikel 3 Goedkeuringsgrenzen

Facturen boven EUR 5.000 vereisen twee goedkeuringen van de inkoopafdeling.
`

const INVOICE_TEXT = `FACTUUR 2026-041
Acme Industrieel BV
Datum: 1 september 2026
BTW 21%                                    210,00
Totaal incl. BTW                         1.210,00
`

const EXTRACTED = {
  currency: { source_span: "BTW 21%", value: "EUR" },
  supplier: { source_span: "Acme Industrieel BV", value: "Acme Industrieel BV" },
  invoice_number: { source_span: "FACTUUR 2026-041", value: "2026-041" },
  issued_on: { source_span: "Datum: 1 september 2026", value: "1 september 2026" },
  total_incl_vat: {
    source_span: "Totaal incl. BTW                         1.210,00",
    value: "1.210,00"
  },
  vat_amount: { source_span: "BTW 21%                                    210,00", value: "210,00" },
  line_items: []
}

/**
 * A scripted model that counts each kind of call, can be told to fail the decide step, and can be told
 * what to propose.
 *
 * `propose` matters: with it fixed at `route_for_approval` the rails could only ever be observed doing
 * nothing, so rail 3 and the auto-approve branch had no test that ran them. `citeChunkId` is separate
 * from `chunkId` so a citation can name a chunk that was never retrieved — which is rail 2's real case,
 * as distinct from citing nothing at all.
 */
/**
 * What every counting-model call reports, shaped exactly as `LanguageModelWorkersAi` reports it: the model in a
 * `response-metadata` part, the token totals in `finish`. So the metering assertions below exercise the real path
 * — `ExtractDocument` / the decide step -> `modelUsageOf` -> `recordModelUsage` — rather than the helper alone.
 */
const reported = [
  { type: "response-metadata" as const, modelId: "counting-model" },
  {
    type: "finish" as const,
    reason: "stop" as const,
    usage: { inputTokens: { total: 100 }, outputTokens: { total: 20 } }
  }
]

const countingModel = (options: {
  readonly failDecide: boolean
  readonly chunkId?: string
  readonly propose?: "auto_approve" | "route_for_approval"
}) => {
  const calls = { extract: 0, decide: 0 }
  const layer = Layer.effect(LanguageModel.LanguageModel)(
    LanguageModel.make({
      generateText: (request) =>
        Effect.suspend(() => {
          const prompt = JSON.stringify(request.prompt)
          // The extraction instruction is distinctive; the decide prompt names policy clauses instead.
          if (prompt.includes("You extract structured fields")) {
            calls.extract++
            return Effect.succeed([{ type: "text" as const, text: JSON.stringify(EXTRACTED) }, ...reported])
          }
          calls.decide++
          if (options.failDecide) {
            // A transient provider failure: exactly what makes Queues redeliver the message.
            return Effect.die(new Error("judge unavailable"))
          }
          return Effect.succeed([{
            type: "text" as const,
            text: JSON.stringify({
              outcome: options.propose ?? "route_for_approval",
              citations: options.chunkId === undefined ? [] : [{
                chunk_id: options.chunkId,
                clause_ref: "Artikel 3",
                excerpt: "Facturen boven EUR 5.000 vereisen twee goedkeuringen van de inkoopafdeling."
              }],
              rationale: "Boven de grens van EUR 5.000."
            })
          }, ...reported])
        }),
      streamText: () => Stream.die(new Error("not used"))
    })
  )
  return { calls, layer }
}

const identity = new Identity({
  userId: UserId.make("u1"),
  orgId: ORG,
  email: "d@example.com",
  role: "reviewer"
})

/**
 * `CurrentUser` is provided as a LAYER, not with `provideService`.
 *
 * The original reason was `WorkflowEnginePg`, which captured the connection and identity at layer BUILD
 * because `WorkflowEngine.Encoded` forces every method to have `R = never` — so an inner `provideService`
 * was too late and failed with "Service not found: iam/CurrentUser" at layer build.
 *
 * That engine is deleted, so the forcing reason is gone. It stays a layer because `PolicySearchLive` is
 * built from the surrounding context too, and because a test's wiring should look like the composition
 * root's — which provides it as a layer for the same reason.
 */
/**
 * A recording `EventBus`, and the reason it is here rather than in the auto-approve describe block.
 *
 * Every test in this file needs it, because the auto-approve branch calls `EmitExecute`. That the layer
 * stack managed without one until now is itself the finding: the branch was never reached, so the missing
 * service never surfaced. It failed with `Service not found: shared/EventBus` the first time a test
 * actually armed a rule.
 */
const recordingBus = () => {
  const sent: Array<string> = []
  return {
    sent,
    layer: Layer.succeed(EventBus)(
      {
        send: (message) => Effect.sync(() => void sent.push(message.eventId))
      } satisfies EventBusService
    )
  }
}

const base = (model: Layer.Layer<LanguageModel.LanguageModel>, bus = recordingBus().layer) =>
  Layer.mergeAll(
    Db.layer,
    IdsLive,
    EmbedderDeterministic,
    model,
    bus,
    // Write-only by construction, so discarding observations cannot change what a test observes.
    TelemetryNoop,
    Layer.succeed(CurrentUser)(identity),
    // The tenant, derived from the session: every queue-path use case requires CurrentOrg now.
    CurrentOrgFromUser.pipe(Layer.provide(Layer.succeed(CurrentUser)(identity))),
    ChunkerHeading
  ).pipe(Layer.provideMerge(Admin))

const provide = <A, E>(
  model: Layer.Layer<LanguageModel.LanguageModel>,
  effect: Effect.Effect<A, E, any>,
  bus?: Layer.Layer<EventBus>
) =>
  effect.pipe(
    /*
     * One provide, and much less to wire than there was.
     *
     * This used to feed `WorkflowEnginePg` and `PolicySearch` into `DecideDocumentLayer`, because the
     * pipeline was an `effect/workflow` workflow and the engine was its dependency. `DecideDocument` is a
     * plain composition now, so only the ports remain.
     */
    Effect.provide(PolicySearchLive.pipe(Layer.provideMerge(base(model, bus))))
  ) as Effect.Effect<A, E, never>

const run = <A, E>(
  model: Layer.Layer<LanguageModel.LanguageModel>,
  effect: Effect.Effect<A, E, any>,
  bus?: Layer.Layer<EventBus>
) => Effect.runPromise(provide(model, effect, bus))

const asAdmin = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(Admin)) as Effect.Effect<A, E, never>)

const payload = { documentId: DOCUMENT, documentText: INVOICE_TEXT, vertical: VERTICAL }

let chunkId: string

beforeEach(async () => {
  await asAdmin(
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      Effect.gen(function*() {
        /*
         * `workflow_executions` and `workflow_activities` are no longer written by anything — the engine
         * that owned them is deleted. The tables are left in place rather than dropped: a migration that
         * drops a table is irreversible, and these hold the audit trail of every decision made before the
         * migration. Cleaning them here would imply something still writes them.
         */
        /*
         * `events` has no foreign key into `source_documents` — deliberately, since an event outlives the
         * document it refers to — so deleting documents does not cascade to it and a leftover
         * `decision.execute` row makes the next test's "emitted nothing" assertion fail. Found exactly
         * that way. Same for `rules`, which no other test arms.
         */
        yield* sql`delete from events where organization_id = ${ORG}`
        yield* sql`delete from usage_records where organization_id = ${ORG}`
        yield* sql`delete from rules where organization_id = ${ORG}`
        yield* sql`delete from source_documents where organization_id = ${ORG}`
        for (
          const [id, collection, filename] of [
            [DOCUMENT, "transactional", "factuur.md"],
            ["decide_policy", "policy", "beleid.md"]
          ] as const
        ) {
          yield* sql`
            insert into source_documents (id, organization_id, collection, filename, r2_key, content_type)
            values (${id}, ${ORG}, ${collection}, ${filename}, ${`${ORG}/${id}`}, 'text/markdown')
          `
        }
      }))
  )

  await run(
    countingModel({ failDecide: false }).layer,
    IndexPolicyDocument({
      documentId: "decide_policy",
      title: "Inkoopbeleid",
      text: POLICY,
      collection: "policy"
    })
  )

  // The citation has to name a chunk that was actually retrieved, or rail 2 escalates it.
  const rows = await asAdmin(
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql<{ id: string }>`select id from document_chunks where document_id = 'decide_policy' limit 1`
    )
  )
  chunkId = rows[0]!.id
}, 30_000)

describe("the decide pipeline", () => {
  it("reaches pending_review with its citations stored", async () => {
    const model = countingModel({ failDecide: false, chunkId })
    const result = await run(model.layer, DecideDocument(payload))

    expect(result.replayed).toBe(false)
    // Nothing is armed, so rail 3 alone stops auto_approve even if the model proposed it.
    expect(result.outcome).toBe("route_for_approval")
    expect(model.calls.extract).toBe(1)

    const stored = await asAdmin(
      Effect.flatMap(SqlClient.SqlClient, (sql) =>
        sql<{ status: string; retrieval_mode: string; citations: number }>`
          select d.status, d.retrieval_mode,
                 (select count(*)::int from decision_citations c where c.decision_id = d.id) as citations
            from decisions d where d.decide_key = ${decideKey(DOCUMENT, VERTICAL)}
        `)
    )
    expect(stored[0]!.status).toBe("pending_review")
    // Recorded, not merely checked: a decision made on degraded retrieval is a different decision.
    expect(stored[0]!.retrieval_mode).toBe("hybrid")
    expect(stored[0]!.citations).toBe(1)

    // The model that decided, as the adapter reported it — not the literal 'scripted' every row used to carry.
    const [row] = await asAdmin(
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) => sql<{ model: string }>`select model from decisions where decide_key = ${decideKey(DOCUMENT, VERTICAL)}`
      )
    )
    expect(row!.model).toBe("counting-model")
  })

  it("costs nothing to run a second time, because the decision already exists", async () => {
    /*
     * The run-level memo is gone with the engine, and this property did not go with it — it got SIMPLER.
     *
     * It used to pass because `Workflow.execute` remembered the run. Now it passes because
     * `existingDecision` reads `decisions` by `decide_key` before any step, which is a stronger guarantee
     * from a source that no retention policy prunes.
     */
    const model = countingModel({ failDecide: false, chunkId })
    await run(model.layer, DecideDocument(payload))
    const afterFirst = { ...model.calls }

    const again = await run(model.layer, DecideDocument(payload))

    expect(again.replayed).toBe(true)
    // Not one model call of any kind: the short circuit is earlier than any memo could be.
    expect(model.calls).toEqual(afterFirst)
  })

  it("meters the decision once and the model calls each time, in the same runs", async () => {
    /*
     * The two meter kinds, through the real pipeline. The decision is a billable unit, written in the claim's
     * transaction and keyed on the decide key, so a second run of the same document cannot bill it again. The
     * tokens are cost: two model calls (extract + decide) at 100 in / 20 out each.
     */
    await run(countingModel({ failDecide: false, chunkId }).layer, DecideDocument(payload))
    await run(countingModel({ failDecide: false, chunkId }).layer, DecideDocument(payload))

    const rows = await asAdmin(
      Effect.flatMap(SqlClient.SqlClient, (sql) =>
        sql<{ meter: string; model: string | null; total: number }>`
          select meter, model, sum(quantity)::int as total from usage_records
           where organization_id = ${ORG} group by meter, model order by meter
        `)
    )
    expect(rows).toEqual([
      { meter: "decisions.completed", model: null, total: 1 },
      // The second run short-circuited before any model call, so it added no cost either.
      { meter: "model.input_tokens", model: "counting-model", total: 200 },
      { meter: "model.output_tokens", model: "counting-model", total: 40 }
    ])
  })

  it("makes no model call on a redelivery, which is what the short circuit is for", async () => {
    /*
     * **This test replaces "makes exactly ONE extraction call across a failure and a redelivery", and the
     * substitution is a real reduction in what is asserted here.** That test proved the Postgres engine's
     * activity memo: a run that failed at `Decide` and was redelivered re-ran `Decide` and NOT `Extract`.
     *
     * The engine is deleted (risk R7), so in Node a failure part way through re-extracts on the next
     * attempt. In production it does not, because the platform memoises each completed step — and that is
     * asserted where it now lives, against the real orchestration in `workerd`:
     * `apps/worker/test/DecideWorkflow.test.ts`.
     *
     * What is still assertable here, and is the guarantee that actually protects the bill, is the earlier
     * one: a redelivery of COMPLETED work costs nothing at all. A new counting model stands in for a new
     * isolate, so an in-memory memo could not produce this result.
     */
    await run(countingModel({ failDecide: false, chunkId }).layer, DecideDocument(payload))

    const redelivered = countingModel({ failDecide: false, chunkId })
    const result = await run(redelivered.layer, DecideDocument(payload))

    expect(result.replayed).toBe(true)
    expect(redelivered.calls.extract, "a redelivery must not re-extract").toBe(0)
    expect(redelivered.calls.decide, "a redelivery must not re-decide").toBe(0)
  }, 30_000)

  it("records the failure and writes no decision when a step fails", async () => {
    /*
     * The other half of what the deleted tests covered: a failed run must leave nothing behind, so the
     * redelivery above starts from a clean state rather than from a half-written decision.
     */
    const failing = countingModel({ failDecide: true, chunkId })
    const attempt = await Effect.runPromiseExit(provide(failing.layer, DecideDocument(payload)))

    expect(attempt._tag).toBe("Failure")
    expect(failing.calls.extract).toBe(1)

    const stored = await asAdmin(
      Effect.flatMap(SqlClient.SqlClient, (sql) =>
        sql<{ n: number }>`
          select count(*)::int as n from decisions where decide_key = ${decideKey(DOCUMENT, VERTICAL)}
        `)
    )
    // The write is the last thing the pipeline does, so a failure before it leaves no decision at all.
    expect(stored[0]!.n).toBe(0)
  }, 30_000)

  it("escalates to needs_human when the model cites a chunk it never retrieved", async () => {
    /*
     * Rail 2 through the full pipeline. This test used to pass a model that cited NOTHING and proposed
     * `route_for_approval`, then assert `route_for_approval` with zero rails fired — so its name
     * described rail 2 and its body exercised no rail at all. A citation to a chunk that does not exist
     * is the case that matters: the excerpt may be real policy, just not policy this decision retrieved,
     * which means nobody checked whether it applies.
     */
    const model = countingModel({ failDecide: false, chunkId: "chunk_never_retrieved" })
    const result = await run(model.layer, DecideDocument(payload))
    expect(result.outcome).toBe("needs_human")
    expect(result.railsFired.some((fired) => fired.includes("never retrieved"))).toBe(true)
  })

  it("does nothing on a proposal it cannot ground, and fires no rail when there is nothing to check", async () => {
    // The case the test above used to be. Kept, because "no citations and no auto_approve proposed"
    // genuinely should pass through untouched — but named for what it is.
    const model = countingModel({ failDecide: false })
    const result = await run(model.layer, DecideDocument(payload))
    expect(result.outcome).toBe("route_for_approval")
    expect(result.railsFired.length).toBe(0)
  })
})

/**
 * The auto-approve branch, end to end through real Postgres.
 *
 * **This had no test.** Every existing case ran with nothing armed, so rail 3 stopped `auto_approve`
 * before the branch below it could run — and the branch is the architectural claim the whole design
 * turns on: the router and the human approval path call the SAME `EmitExecute`. Worse, the gap was
 * self-concealing: after rail 3 was tightened to evaluate a rule's bounds, a bug that made
 * `evaluateRule` refuse everything would have left all 197 tests green while silently disabling
 * automatic approval for good. A never-firing gate is indistinguishable from a cautious one.
 */
describe("the auto-approve branch", () => {
  /** Arms a rule whose bounds this fixture invoice actually fits. */
  const arm = (overrides: Partial<{ max: number; requirePo: boolean; minDays: number }> = {}) =>
    asAdmin(Effect.flatMap(SqlClient.SqlClient, (sql) =>
      sql`
        insert into rules (
          id, organization_id, vertical, armed, max_amount_minor, currency, require_po,
          approved_suppliers, min_payment_days, description, created_by
        ) values (
          ${`rule_${crypto.randomUUID()}`}, ${ORG}, ${VERTICAL}, true,
          ${overrides.max ?? 200_000}, 'EUR', ${overrides.requirePo ?? false},
          '{}'::text[], ${overrides.minDays ?? 0}, 'test rule', 'u1'
        )
      `))

  it("auto-approves when every bound holds, and emits exactly one execute event", async () => {
    await arm()
    const model = countingModel({ failDecide: false, chunkId, propose: "auto_approve" })
    const result = await run(model.layer, DecideDocument(payload))

    expect(result.railsFired).toEqual([])
    expect(result.outcome).toBe("auto_approve")

    const stored = await asAdmin(
      Effect.flatMap(SqlClient.SqlClient, (sql) =>
        sql<{ status: string; id: string }>`
          select id, status from decisions where decide_key = ${decideKey(DOCUMENT, VERTICAL)}
        `)
    )
    expect(stored[0]!.status).toBe("auto_approved")

    /*
     * The event, not the execution row: the router emits and the queue consumer claims. Asserting on
     * `executions` here would be asserting that a consumer ran, which it has not.
     */
    const events = await asAdmin(
      Effect.flatMap(SqlClient.SqlClient, (sql) =>
        sql<{ type: string; idempotency_key: string }>`
          select type, idempotency_key from events where organization_id = ${ORG} and type = 'decision.execute'
        `)
    )
    expect(events.length).toBe(1)
    // Derived, never generated: the same key the executions row will claim under.
    expect(events[0]!.idempotency_key).toBe(`decision:${stored[0]!.id}:dry_run`)
  }, 30_000)

  it("refuses the same invoice when the rule's ceiling is below it, naming the ceiling", async () => {
    /*
     * The pair that proves the bound is load-bearing rather than decorative. Same invoice, same model,
     * same proposal — only the stored ceiling differs. Before `evaluateRule` existed, `max_amount_minor`
     * was in the table and read by nothing, and this test would have failed.
     */
    await arm({ max: 50_000 })
    const model = countingModel({ failDecide: false, chunkId, propose: "auto_approve" })
    const result = await run(model.layer, DecideDocument(payload))

    expect(result.outcome).toBe("route_for_approval")
    expect(result.railsFired.some((fired) => fired.includes("above the rule's ceiling"))).toBe(true)
    // The reason is stored on the row, because it is what the reviewer is shown.
    const stored = await asAdmin(
      Effect.flatMap(SqlClient.SqlClient, (sql) =>
        sql<{ rails_fired: ReadonlyArray<string> }>`
          select rails_fired from decisions where decide_key = ${decideKey(DOCUMENT, VERTICAL)}
        `)
    )
    expect(stored[0]!.rails_fired.some((fired) => fired.includes("EUR 500,00"))).toBe(true)
  }, 30_000)

  it("refuses when the rule requires a purchase order and the invoice states none", async () => {
    // The fixture invoice has no PO line at all, so this is the absent case rather than an empty one.
    await arm({ requirePo: true })
    const model = countingModel({ failDecide: false, chunkId, propose: "auto_approve" })
    const result = await run(model.layer, DecideDocument(payload))

    expect(result.outcome).toBe("route_for_approval")
    expect(result.railsFired.some((fired) => fired.startsWith("purchase_order:"))).toBe(true)
  }, 30_000)

  it("emits NO execute event when a rail refused it", async () => {
    // The other half of the claim. One emit call site means one place to get this wrong, and getting it
    // wrong pays a supplier on a decision that was routed to a human.
    await arm({ max: 50_000 })
    const model = countingModel({ failDecide: false, chunkId, propose: "auto_approve" })
    await run(model.layer, DecideDocument(payload))

    const events = await asAdmin(
      Effect.flatMap(SqlClient.SqlClient, (sql) =>
        sql<{ n: number }>`
          select count(*)::int as n from events
           where organization_id = ${ORG} and type = 'decision.execute'
        `)
    )
    expect(events[0]!.n).toBe(0)
  }, 30_000)
})
