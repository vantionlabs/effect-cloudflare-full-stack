/**
 * The human boundary and the one execution path, against real Postgres.
 *
 * Two assertions the plan names by hand:
 *
 *   approve from two tabs → ONE event, ONE execution;
 *   an auto-approved decision produces a byte-identical `executions` row shape.
 *
 * The second is the codebase's central architectural claim made checkable. Without it, "the automatic path
 * does the same thing as the human one" is a sentence in a document.
 */
import { Adapter, AdapterFailed, type AdapterService } from "@ea/modules/decision/domain/Execution"
import { DryRunAdapter } from "@ea/modules/decision/server/Execution"
import { ApproveDecision, RejectDecision } from "@ea/modules/decision/use-cases/Decision"
import { ExecuteDecision, executionKey } from "@ea/modules/decision/use-cases/Execution"
import { EventBus, type EventBusService } from "@ea/modules/shared/domain/Event"
import { CurrentUser, Identity, OrgId, UserId } from "@ea/modules/shared/domain/Identity"
import { Ids } from "@ea/modules/shared/domain/Ids"
import { Db } from "@ea/modules/shared/tables/Database"
import { PgClient } from "@effect/sql-pg"
import { Effect, Layer, Redacted } from "effect"
import { SqlClient } from "effect/sql"
import { beforeEach, describe, expect, it } from "vitest"

const ORG = OrgId.make("exec_org")
const DOCUMENT = "exec_doc"

const Admin = PgClient.layer({
  host: "localhost",
  port: 55433,
  username: "effect_ai",
  password: Redacted.make("local_dev_only"),
  database: "effect_ai",
  ssl: false
})

const IdsLive = Layer.succeed(Ids)({ next: Effect.sync(() => crypto.randomUUID()) })

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

const identity = (userId: string) =>
  new Identity({ userId: UserId.make(userId), orgId: ORG, email: "r@example.com", role: "reviewer" })

const run = <A, E>(
  userId: string,
  effect: Effect.Effect<A, E, any>,
  extra: Layer.Layer<never> | Layer.Layer<EventBus> | Layer.Layer<Adapter> = Layer.empty
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provideService(CurrentUser, identity(userId)),
      Effect.provide(Layer.mergeAll(Db.layer, IdsLive, DryRunAdapter, extra as Layer.Layer<never>)),
      Effect.provide(Admin)
    ) as Effect.Effect<A, E, never>
  )

const asAdmin = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(Admin)) as Effect.Effect<A, E, never>)

/** Seeds a decision in `pending_review`, which is the only state a review may act on. */
const seedDecision = (id: string, status = "pending_review") =>
  asAdmin(
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      sql`
        insert into decisions (
          id, organization_id, document_id, vertical, decide_key, outcome, status, rationale,
          retrieval_mode, grounded, model
        ) values (
          ${id}, ${ORG}, ${DOCUMENT}, 'invoice', ${`decision:${id}:invoice`}, 'route_for_approval',
          ${status}, 'because', 'hybrid', true, 'scripted'
        )
      `)
  )

const executionsFor = (decisionId: string) =>
  asAdmin(
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      sql<{
        decision_id: string
        action: string
        idempotency_key: string
        provider_idempotency_key: string
        status: string
        approved_by: string | null
      }>`
        select decision_id, action, idempotency_key, provider_idempotency_key, status, approved_by
          from executions where decision_id = ${decisionId}
      `)
  )

beforeEach(async () => {
  await asAdmin(
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      Effect.gen(function*() {
        yield* sql`delete from source_documents where organization_id = ${ORG}`
        yield* sql`delete from events where organization_id = ${ORG}`
        yield* sql`
          insert into source_documents (id, organization_id, collection, filename, r2_key, content_type)
          values (${DOCUMENT}, ${ORG}, 'transactional', 'f.md', ${`${ORG}/${DOCUMENT}`}, 'text/markdown')
        `
      }))
  )
})

describe("the human boundary", () => {
  it("approves once and emits once", async () => {
    await seedDecision("d1")
    const bus = recordingBus()
    const outcome = await run("u1", ApproveDecision("d1"), bus.layer)

    expect(outcome._tag).toBe("Approved")
    expect(bus.sent).toHaveLength(1)
  })

  it("approve from TWO TABS produces one event and one execution", async () => {
    /*
     * The assertion the plan names. Both reviewers issue the update; the `where status = 'pending_review'`
     * clause means one matches a row and one does not, and only the winner emits.
     */
    await seedDecision("d2")
    const bus = recordingBus()

    const [first, second] = await Promise.all([
      run("tab-one", ApproveDecision("d2"), bus.layer),
      run("tab-two", ApproveDecision("d2"), bus.layer)
    ])

    const outcomes = [first._tag, second._tag].sort()
    expect(outcomes).toEqual(["Approved", "NotPending"])
    // ONE event, not two deduplicated later: the CAS is what prevents the second, so the loser learns
    // it lost rather than believing it succeeded.
    expect(bus.sent).toHaveLength(1)

    // And the claim allows exactly one execution even if both had tried.
    await Promise.all([
      run("tab-one", ExecuteDecision({ decisionId: "d2", action: "dry_run", approvedBy: "tab-one" })),
      run("tab-two", ExecuteDecision({ decisionId: "d2", action: "dry_run", approvedBy: "tab-two" }))
    ])
    expect(await executionsFor("d2")).toHaveLength(1)
  })

  it("refuses to review a decision that is not pending", async () => {
    await seedDecision("d3", "approved")
    const bus = recordingBus()
    const outcome = await run("u1", ApproveDecision("d3"), bus.layer)

    expect(outcome._tag).toBe("NotPending")
    expect(bus.sent).toEqual([])
  })

  it("rejects without emitting anything", async () => {
    await seedDecision("d4")
    const bus = recordingBus()
    const outcome = await run("u1", RejectDecision("d4"), bus.layer)

    expect(outcome._tag).toBe("Rejected")
    // A rejection is a decision, not work. Nothing downstream should happen.
    expect(bus.sent).toEqual([])
  })
})

describe("the one execution path", () => {
  it("claims, calls the adapter and records the response", async () => {
    await seedDecision("e1")
    const outcome = await run("u1", ExecuteDecision({ decisionId: "e1", action: "dry_run", approvedBy: "u1" }))

    expect(outcome._tag).toBe("Executed")
    const rows = await executionsFor("e1")
    expect(rows[0]!.status).toBe("succeeded")
    // The provider's dedupe key is the SAME derived key, so a replay is a no-op at the target.
    expect(rows[0]!.provider_idempotency_key).toBe(executionKey("e1", "dry_run"))
  })

  it("a second attempt finds the claim held rather than acting twice", async () => {
    await seedDecision("e2")
    await run("u1", ExecuteDecision({ decisionId: "e2", action: "dry_run", approvedBy: "u1" }))
    const again = await run("u2", ExecuteDecision({ decisionId: "e2", action: "dry_run", approvedBy: "u2" }))

    // Not an error: the work is being done, just not by us.
    expect(again._tag).toBe("AlreadyClaimed")
    expect(await executionsFor("e2")).toHaveLength(1)
  })

  it("marks an adapter failure needs_attention and NEVER retries it", async () => {
    /*
     * The window that cannot be closed. The call may have succeeded before failing to report, so retrying
     * could pay a supplier twice — and a human is the only safe resolver.
     */
    await seedDecision("e3")
    const failing = Layer.succeed(Adapter)(
      {
        name: "failing",
        providerIdempotent: false,
        execute: () => Effect.fail(new AdapterFailed("connection reset after send"))
      } satisfies AdapterService
    )

    const outcome = await run("u1", ExecuteDecision({ decisionId: "e3", action: "dry_run" }), failing)

    expect(outcome._tag).toBe("Ambiguous")
    expect((await executionsFor("e3"))[0]!.status).toBe("needs_attention")

    // The decision moves too, so it surfaces in the queue rather than looking settled.
    const decision = await asAdmin(
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) => sql<{ status: string }>`select status from decisions where id = 'e3'`
      )
    )
    expect(decision[0]!.status).toBe("needs_attention")
  })
})

describe("the automatic path and the human path agree", () => {
  it("produces an identical execution row but for approved_by", async () => {
    /*
     * THE assertion. Both rows come from `ExecuteDecision`, so the only permitted difference is who
     * approved — null for automatic, which is itself the audit record. Any other divergence means the two
     * paths have drifted, which is precisely what a single shared function is supposed to make impossible.
     */
    await seedDecision("h1")
    await seedDecision("a1")

    await run("reviewer", ExecuteDecision({ decisionId: "h1", action: "dry_run", approvedBy: "reviewer" }))
    // The automatic path passes no approver. Everything else is the same call.
    await run("system", ExecuteDecision({ decisionId: "a1", action: "dry_run" }))

    const [human] = await executionsFor("h1")
    const [automatic] = await executionsFor("a1")

    expect(human!.approved_by).toBe("reviewer")
    expect(automatic!.approved_by).toBeNull()

    const shape = (row: NonNullable<typeof human>) => ({
      action: row.action,
      status: row.status,
      keyMatchesDecision: row.idempotency_key === executionKey(row.decision_id, "dry_run"),
      providerKeyMatchesKey: row.provider_idempotency_key === row.idempotency_key
    })
    expect(shape(automatic!)).toEqual(shape(human!))
  })
})
