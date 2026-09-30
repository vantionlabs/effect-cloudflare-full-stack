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
import { WorkflowEnginePg } from "@ea/modules/decision/server/Workflow"
import { DecideDocumentLayer, DecideDocumentWorkflow, decideKey } from "@ea/modules/decision/use-cases/Decision"
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
            return Effect.succeed([{ type: "text" as const, text: JSON.stringify(EXTRACTED) }])
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
          }])
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
 * `WorkflowEnginePg` captures the connection and identity when the layer is BUILT — see that file for
 * why `WorkflowEngine.Encoded` forces it — so an inner `provideService` is too late: the layer is
 * constructed from the surrounding context, which does not have it yet. The failure is
 * "Service not found: iam/CurrentUser" at layer build, which is not obvious from the call site.
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
     * One provide, mirroring apps/worker/src/platform/DispatchEvent.ts.
     *
     * `DecideDocumentLayer` requires both `WorkflowEngine` and `PolicySearch`, so `Layer.mergeAll` of
     * all of them would leave those unsatisfied — merge is side-by-side, not wiring. `provideMerge`
     * feeds them in and keeps their outputs visible, which is what the chain did.
     */
    Effect.provide(
      DecideDocumentLayer.pipe(
        Layer.provideMerge(Layer.mergeAll(WorkflowEnginePg, PolicySearchLive)),
        Layer.provideMerge(base(model, bus))
      )
    )
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

/**
 * The engine's execution id, which is NOT the idempotency key.
 *
 * `Workflow.execute` hashes `<tagLength>:<tag>:<idempotencyKey>` into a digest, so a test that filtered
 * on `decideKey(...)` finds nothing and passes for the wrong reason if it asserts absence. Asking the
 * workflow for it keeps the test honest about what the engine actually stores.
 */
const executionId = () =>
  Effect.runPromise(
    DecideDocumentWorkflow.executionId(payload) as Effect.Effect<string, never, never>
  )

beforeEach(async () => {
  await asAdmin(
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      Effect.gen(function*() {
        yield* sql`delete from workflow_executions where organization_id = ${ORG}`
        /*
         * `events` has no foreign key into `source_documents` — deliberately, since an event outlives the
         * document it refers to — so deleting documents does not cascade to it and a leftover
         * `decision.execute` row makes the next test's "emitted nothing" assertion fail. Found exactly
         * that way. Same for `rules`, which no other test arms.
         */
        yield* sql`delete from events where organization_id = ${ORG}`
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
    const result = await run(model.layer, DecideDocumentWorkflow.execute(payload))

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
  })

  it("costs nothing to run a second time, because the run itself is memoised", async () => {
    const model = countingModel({ failDecide: false, chunkId })
    await run(model.layer, DecideDocumentWorkflow.execute(payload))
    const afterFirst = { ...model.calls }

    await run(model.layer, DecideDocumentWorkflow.execute(payload))

    // The RUN-level memo short-circuits before the body, so not one model call of any kind.
    expect(model.calls).toEqual(afterFirst)
  })

  it("still refuses to decide twice if the workflow memo is gone", async () => {
    /*
     * The run memo and the decide_key constraint are two independent defences, and this proves the
     * second one alone. Workflow rows are the kind of thing a retention policy prunes; the decision
     * must still not be made a second time when they are absent.
     */
    const model = countingModel({ failDecide: false, chunkId })
    await run(model.layer, DecideDocumentWorkflow.execute(payload))
    const afterFirst = { ...model.calls }

    const id = await executionId()
    await asAdmin(
      Effect.flatMap(SqlClient.SqlClient, (sql) => sql`delete from workflow_executions where execution_id = ${id}`)
    )

    const again = await run(model.layer, DecideDocumentWorkflow.execute(payload))

    expect(again.replayed).toBe(true)
    // It entered the workflow body this time, and still made no model call: the decide_key lookup
    // happens before the first activity.
    expect(model.calls).toEqual(afterFirst)
  })

  it("makes exactly ONE extraction call across a failure and a redelivery", async () => {
    const failing = countingModel({ failDecide: true, chunkId })
    const firstAttempt = await Effect.runPromiseExit(
      provide(failing.layer, DecideDocumentWorkflow.execute(payload))
    )

    expect(firstAttempt._tag).toBe("Failure")
    expect(failing.calls.extract).toBe(1)
    expect(failing.calls.decide).toBe(1)

    /*
     * The redelivery, with a NEW counting model standing in for a new isolate.
     *
     * That substitution is the point of the whole engine: an in-memory memo would have forgotten
     * everything here, which is precisely why the memo lives in Postgres (ADR-0003).
     */
    const retry = countingModel({ failDecide: false, chunkId })
    const result = await run(retry.layer, DecideDocumentWorkflow.execute(payload))

    expect(result.outcome).toBe("route_for_approval")
    // Replayed from workflow_activities. THIS is the assertion the engine exists for.
    expect(retry.calls.extract, "extraction must NOT run again after a redelivery").toBe(0)
    // The step that failed does run again, which is exactly right.
    expect(retry.calls.decide).toBe(1)
  }, 30_000)

  it("memoises each activity exactly once, under the right workflow name", async () => {
    await run(countingModel({ failDecide: false, chunkId }).layer, DecideDocumentWorkflow.execute(payload))
    const id = await executionId()

    const named = await asAdmin(
      Effect.flatMap(SqlClient.SqlClient, (sql) =>
        sql<{ workflow_name: string }>`
          select workflow_name from workflow_executions where execution_id = ${id}
        `)
    )
    // Guards a real bug: keying the registry on `workflow.name` stores "Workflow" for every
    // definition, so all of them share one entry and the last registration wins.
    expect(named[0]!.workflow_name).toBe("DecideDocument")

    const rows = await asAdmin(
      Effect.flatMap(SqlClient.SqlClient, (sql) =>
        sql<{ name: string; n: number }>`
          select name, count(*)::int as n from workflow_activities
           where execution_id = ${id}
           group by name order by name
        `)
    )

    expect(rows.map((row) => row.name)).toEqual(["Decide", "Extract", "Retrieve"])
    expect(rows.every((row) => row.n === 1)).toBe(true)
  })

  it("escalates to needs_human when the model cites a chunk it never retrieved", async () => {
    /*
     * Rail 2 through the full pipeline. This test used to pass a model that cited NOTHING and proposed
     * `route_for_approval`, then assert `route_for_approval` with zero rails fired — so its name
     * described rail 2 and its body exercised no rail at all. A citation to a chunk that does not exist
     * is the case that matters: the excerpt may be real policy, just not policy this decision retrieved,
     * which means nobody checked whether it applies.
     */
    const model = countingModel({ failDecide: false, chunkId: "chunk_never_retrieved" })
    const result = await run(model.layer, DecideDocumentWorkflow.execute(payload))
    expect(result.outcome).toBe("needs_human")
    expect(result.railsFired.some((fired) => fired.includes("never retrieved"))).toBe(true)
  })

  it("does nothing on a proposal it cannot ground, and fires no rail when there is nothing to check", async () => {
    // The case the test above used to be. Kept, because "no citations and no auto_approve proposed"
    // genuinely should pass through untouched — but named for what it is.
    const model = countingModel({ failDecide: false })
    const result = await run(model.layer, DecideDocumentWorkflow.execute(payload))
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
      Effect.gen(function*() {
        yield* sql`
          insert into rules (
            id, organization_id, vertical, armed, max_amount_minor, currency, require_po,
            approved_suppliers, min_payment_days, description, created_by
          ) values (
            ${`rule_${crypto.randomUUID()}`}, ${ORG}, ${VERTICAL}, true,
            ${overrides.max ?? 200_000}, 'EUR', ${overrides.requirePo ?? false},
            '{}'::text[], ${overrides.minDays ?? 0}, 'test rule', 'u1'
          )
        `
      })))

  it("auto-approves when every bound holds, and emits exactly one execute event", async () => {
    await arm()
    const model = countingModel({ failDecide: false, chunkId, propose: "auto_approve" })
    const result = await run(model.layer, DecideDocumentWorkflow.execute(payload))

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
    const result = await run(model.layer, DecideDocumentWorkflow.execute(payload))

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
    const result = await run(model.layer, DecideDocumentWorkflow.execute(payload))

    expect(result.outcome).toBe("route_for_approval")
    expect(result.railsFired.some((fired) => fired.startsWith("purchase_order:"))).toBe(true)
  }, 30_000)

  it("emits NO execute event when a rail refused it", async () => {
    // The other half of the claim. One emit call site means one place to get this wrong, and getting it
    // wrong pays a supplier on a decision that was routed to a human.
    await arm({ max: 50_000 })
    const model = countingModel({ failDecide: false, chunkId, propose: "auto_approve" })
    await run(model.layer, DecideDocumentWorkflow.execute(payload))

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
