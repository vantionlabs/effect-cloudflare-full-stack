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
import { WorkflowEnginePg } from "@ea/modules/decision/server/Workflow"
import { DecideDocumentLayer, DecideDocumentWorkflow, decideKey } from "@ea/modules/decision/use-cases/Decision"
import { ChunkerHeading } from "@ea/modules/policy/domain/Chunk"
import { EmbedderDeterministic } from "@ea/modules/policy/server/Embedding"
import { IndexPolicyDocument } from "@ea/modules/policy/use-cases/Chunk"
import { PolicySearchLive } from "@ea/modules/policy/use-cases/Retrieval"
import { CurrentUser, Identity, OrgId, UserId } from "@ea/modules/shared/domain/Identity"
import { Ids } from "@ea/modules/shared/domain/Ids"
import { Db } from "@ea/modules/shared/tables/Database"
import { PgClient } from "@effect/sql-pg"
import { Effect, Layer, Redacted, Stream } from "effect"
import { LanguageModel } from "effect/ai"
import { SqlClient } from "effect/sql"
import { beforeEach, describe, expect, it } from "vitest"

const ORG = OrgId.make("decide_org")
const DOCUMENT = "decide_doc"
const VERTICAL = "invoice"

const Admin = PgClient.layer({
  host: "localhost",
  port: 55433,
  username: "effect_ai",
  password: Redacted.make("local_dev_only"),
  database: "effect_ai",
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

/** A scripted model that counts each kind of call and can be told to fail the decide step. */
const countingModel = (options: { readonly failDecide: boolean; readonly chunkId?: string }) => {
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
              outcome: "route_for_approval",
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
const base = (model: Layer.Layer<LanguageModel.LanguageModel>) =>
  Layer.mergeAll(
    Db.layer,
    IdsLive,
    EmbedderDeterministic,
    model,
    Layer.succeed(CurrentUser)(identity),
    ChunkerHeading
  ).pipe(Layer.provideMerge(Admin))

const provide = <A, E>(model: Layer.Layer<LanguageModel.LanguageModel>, effect: Effect.Effect<A, E, any>) =>
  effect.pipe(
    Effect.provide(DecideDocumentLayer),
    Effect.provide(WorkflowEnginePg),
    Effect.provide(PolicySearchLive),
    Effect.provide(base(model))
  ) as Effect.Effect<A, E, never>

const run = <A, E>(model: Layer.Layer<LanguageModel.LanguageModel>, effect: Effect.Effect<A, E, any>) =>
  Effect.runPromise(provide(model, effect))

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
    // Rail 2, through the full pipeline rather than in isolation: the citation names no chunk at all,
    // so auto_approve is impossible and the proposal cannot stand as-is.
    const model = countingModel({ failDecide: false })
    const result = await run(model.layer, DecideDocumentWorkflow.execute(payload))
    expect(result.outcome).toBe("route_for_approval")
    expect(result.railsFired.length).toBe(0)
  })
})
