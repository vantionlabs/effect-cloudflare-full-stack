/**
 * The event engine against real Postgres, and specifically the three behaviours the plan names by hand:
 *
 *   a transient error retries;
 *   a DocumentNotFound acks immediately WITHOUT burning retries;
 *   a redelivery of completed work does no work at all.
 *
 * Batch semantics live in the Worker's `queue` handler and are tested there. This is the half that decides
 * *what happened*, which is the half worth testing without a queue.
 */
import { CurrentOrg, CurrentUser, Identity, OrgId, UserId } from "@ea/domain/Identity"
import { Ids } from "@ea/domain/Ids"
import { DocumentNotFound } from "@ea/modules/shared/domain/Errors"
import { EventBus, type EventBusService, EventId, EventSendFailed } from "@ea/modules/shared/domain/Event"
import { Db } from "@ea/modules/shared/tables/Database"
import { ConsumeEvent, EmitEvent, SweepEnqueueGap } from "@ea/modules/shared/use-cases/Event"
import { PgClient } from "@effect/sql-pg"
import { Effect, Layer, Redacted } from "effect"
import { SqlClient } from "effect/sql"
import { beforeEach, describe, expect, it } from "vitest"

const ORG = OrgId.make("event_org")

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

const identity = new Identity({
  userId: UserId.make("u1"),
  orgId: ORG,
  email: "e@example.com",
  role: "reviewer"
})

/** Records what was sent, and can be told to fail — which is how the enqueue gap is exercised. */
const recordingBus = (options: { readonly fail?: boolean } = {}) => {
  const sent: Array<{ eventId: string; type: string }> = []
  const layer = Layer.succeed(EventBus)(
    {
      send: (message) =>
        options.fail === true
          ? Effect.fail(new EventSendFailed("simulated queue outage"))
          : Effect.sync(() => {
            sent.push({ eventId: message.eventId, type: message.type })
          })
    } satisfies EventBusService
  )
  return { sent, layer }
}

const run = <A, E>(bus: Layer.Layer<EventBus>, effect: Effect.Effect<A, E, any>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provideService(CurrentUser, identity),
      Effect.provideService(CurrentOrg, identity.orgId),
      // One provide: the merged layers need the connection `Admin` supplies
      // (`multipleEffectProvide` — chaining builds it against a separate memo map).
      Effect.provide(Layer.mergeAll(Db.layer, IdsLive, bus).pipe(Layer.provideMerge(Admin)))
    ) as Effect.Effect<A, E, never>
  )

const asAdmin = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(Admin)) as Effect.Effect<A, E, never>)

const eventRow = (id: string) =>
  asAdmin(
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      sql<{ status: string; deliveries: number; error: string | null }>`
        select status, deliveries, error from events where id = ${id}
      `)
  )

beforeEach(async () => {
  await asAdmin(
    Effect.flatMap(SqlClient.SqlClient, (sql) => sql`delete from events where organization_id = ${ORG}`)
  )
})

describe("EmitEvent", () => {
  it("writes the row and then sends the message", async () => {
    const bus = recordingBus()
    const result = await run(bus.layer, EmitEvent({ type: "document.decide", idempotencyKey: "k1" }))

    expect(result.created).toBe(true)
    expect(bus.sent).toEqual([{ eventId: result.eventId, type: "document.decide" }])
    expect((await eventRow(result.eventId))[0]!.status).toBe("queued")
  })

  it("is idempotent by derived key: a second emit queues nothing", async () => {
    const bus = recordingBus()
    const first = await run(bus.layer, EmitEvent({ type: "document.decide", idempotencyKey: "k2" }))
    const second = await run(bus.layer, EmitEvent({ type: "document.decide", idempotencyKey: "k2" }))

    expect(second.created).toBe(false)
    // Same identity returned, so a caller can still correlate.
    expect(second.eventId).toBe(first.eventId)
    // And crucially: only ONE message. A duplicate emit must not enqueue twice against one row.
    expect(bus.sent).toHaveLength(1)
  })

  it("leaves a recoverable row when the send fails — the enqueue gap", async () => {
    /*
     * The gap the plan calls the one genuine sweeper. No transaction spans Postgres and Queues, so the
     * row is committed first; a failed send must therefore NOT roll it back, or the work is lost with
     * nothing to recover from.
     */
    const bus = recordingBus({ fail: true })
    const result = await run(bus.layer, EmitEvent({ type: "document.decide", idempotencyKey: "k3" }))

    expect(result.created).toBe(true)
    expect(bus.sent).toEqual([])
    // Queued, with no message in flight. This row is exactly what the cron re-sends.
    expect((await eventRow(result.eventId))[0]!.status).toBe("queued")
  })
})

describe("SweepEnqueueGap", () => {
  /*
   * Closes the loop the test above opens: it leaves a `queued` row with no message and says "this row is
   * exactly what the cron re-sends". Until now nothing re-sent it.
   *
   * The row has to be AGED to be swept — the sweeper ignores anything younger than two minutes, because a
   * row is legitimately `queued` for the milliseconds between commit and the consumer claiming it. Backdating
   * `created_at` is how the boundary gets tested rather than waited out.
   */
  const backdate = (eventId: string, interval: string) =>
    run(
      recordingBus().layer,
      Effect.flatMap(Db, (db) =>
        db.unscopedForCron((sql) =>
          sql`update events set created_at = now() - interval '${sql.literal(interval)}' where id = ${eventId}`
        ))
    )

  it("re-sends a queued row whose message was lost", async () => {
    const lost = recordingBus({ fail: true })
    const { eventId } = await run(lost.layer, EmitEvent({ type: "document.decide", idempotencyKey: "sweep1" }))
    expect(lost.sent).toEqual([])
    /*
     * 30 days, not 5 minutes, and the reason is a finding in itself.
     *
     * The sweeper takes the OLDEST `MAX_PER_TICK` rows, and this database holds hundreds of permanently
     * `queued` events left by other suites — uploads that emitted work no local consumer ever drains.
     * With a 5-minute backdate our row sorted behind them and the sweep filled its 100-row budget before
     * reaching it, so the test failed while the sweeper worked correctly. Backdating past every leftover
     * makes the assertion about behaviour rather than about what else is in the table.
     */
    await backdate(eventId, "30 days")

    const sweeper = recordingBus()
    const result = await run(sweeper.layer, SweepEnqueueGap)

    expect(result.resent).toBeGreaterThanOrEqual(1)
    expect(sweeper.sent.map((m) => m.eventId)).toContain(eventId)
    // The sweeper re-delivers and does NOT repair: touching `status` would race the consumer for the row.
    expect((await eventRow(eventId))[0]!.status).toBe("queued")
  })

  it("does NOT re-send a row that is merely young", async () => {
    /*
     * The half that matters. A sweeper that re-sent every `queued` row would pass the test above while
     * doubling the queue's work on the happy path — every event is `queued` for an instant.
     */
    const lost = recordingBus({ fail: true })
    const { eventId } = await run(lost.layer, EmitEvent({ type: "document.decide", idempotencyKey: "sweep2" }))

    const sweeper = recordingBus()
    await run(sweeper.layer, SweepEnqueueGap)

    expect(sweeper.sent.map((m) => m.eventId)).not.toContain(eventId)
  })

  it("does NOT re-send a row the consumer already finished", async () => {
    // Idempotency is what makes re-sending safe, but not re-sending at all is cheaper than relying on it.
    const { eventId } = await run(
      recordingBus().layer,
      EmitEvent({ type: "document.decide", idempotencyKey: "sweep3" })
    )
    await run(recordingBus().layer, ConsumeEvent(eventId, () => Effect.void))
    await backdate(eventId, "5 minutes")

    const sweeper = recordingBus()
    await run(sweeper.layer, SweepEnqueueGap)

    expect(sweeper.sent.map((m) => m.eventId)).not.toContain(eventId)
  })
})

describe("ConsumeEvent", () => {
  const emit = (key: string) => run(recordingBus().layer, EmitEvent({ type: "document.decide", idempotencyKey: key }))

  it("marks an event done and counts the delivery", async () => {
    const { eventId } = await emit("c1")
    const disposition = await run(
      recordingBus().layer,
      ConsumeEvent(eventId, () => Effect.void)
    )

    expect(disposition._tag).toBe("Done")
    const row = (await eventRow(eventId))[0]!
    expect(row.status).toBe("done")
    expect(row.deliveries).toBe(1)
  })

  it("RETRIES a transient failure and leaves it processing", async () => {
    const { eventId } = await emit("c2")
    const disposition = await run(
      recordingBus().layer,
      ConsumeEvent(eventId, () => Effect.fail(new Error("provider timed out")))
    )

    expect(disposition._tag).toBe("Retry")
    // Not `failed`: Queues owns the retry, and marking it failed here would end the work early.
    expect((await eventRow(eventId))[0]!.status).toBe("processing")
  })

  it("ACKS a DocumentNotFound immediately, without burning retries", async () => {
    // The plan names this one explicitly. docket retried everything and burned three model calls on
    // every deterministic bug; a document that does not exist will not exist on the fifth delivery.
    const { eventId } = await emit("c3")
    const disposition = await run(
      recordingBus().layer,
      ConsumeEvent(eventId, () => Effect.fail(new DocumentNotFound({ documentId: "gone" })))
    )

    expect(disposition._tag).toBe("Terminal")
    const row = (await eventRow(eventId))[0]!
    expect(row.status).toBe("failed")
    // Recorded in the product rather than only in a dashboard.
    expect(row.error).toContain("DocumentNotFound")
    expect(row.deliveries).toBe(1)
  })

  it("does NO WORK when redelivered after completion", async () => {
    const { eventId } = await emit("c4")
    let calls = 0
    const work = () =>
      Effect.sync(() => {
        calls++
      })

    await run(recordingBus().layer, ConsumeEvent(eventId, work))
    await run(recordingBus().layer, ConsumeEvent(eventId, work))

    // The cheapest idempotency layer of the three, and the one that fires most often: earlier than the
    // workflow memo, earlier than the decide_key constraint.
    expect(calls).toBe(1)
    expect((await eventRow(eventId))[0]!.deliveries).toBe(1)
  })

  it("acks an event whose row has vanished", async () => {
    // Nothing to read current state from and nothing to record against, so a redelivery cannot help.
    const disposition = await run(
      recordingBus().layer,
      ConsumeEvent(EventId.make("00000000-0000-0000-0000-000000000000"), () => Effect.void)
    )
    expect(disposition._tag).toBe("Terminal")
  })

  it("takes its tenant from the EVENT, and ignores any ambient one", async () => {
    /*
     * This test asserted the opposite until the pipeline was wired, and the change is deliberate — so it is
     * worth being explicit about what was traded.
     *
     * **Before:** `ConsumeEvent` read the row with `db.scoped`, so the caller's own organization scoped the
     * lookup and another organization's event read as absent. Safe, and unusable from a queue: a consumer
     * has no session, so there was no caller organization to scope by, which is precisely why the queue
     * handler acked every message without doing anything.
     *
     * **Now:** the organization is resolved from the event row by an unscoped point lookup — the one query
     * on this path where the tenant is the *answer* rather than an input — and everything after runs scoped
     * to it. An ambient `CurrentOrg` is irrelevant, which is what this asserts.
     *
     * **So this function is PRIVILEGED**, in the same way `Db.unscopedForAuth` is. It must not be reachable
     * from a request path, and that is enforced rather than trusted: `bun run dep:check` fails if anything
     * other than the Worker's queue dispatch imports it.
     */
    const { eventId } = await emit("c5")
    const other = OrgId.make("event_org_other")

    let observedOrg: string | null = null
    const disposition = await Effect.runPromise(
      ConsumeEvent(eventId, () => Effect.flatMap(CurrentOrg, (orgId) => Effect.sync(() => void (observedOrg = orgId))))
        .pipe(
          // An ambient tenant belonging to somebody else, which must have no effect whatsoever.
          Effect.provideService(CurrentOrg, other),
          // One provide: the merged layers need the connection `Admin` supplies
          // (`multipleEffectProvide` — chaining builds it against a separate memo map).
          Effect.provide(Layer.mergeAll(Db.layer, IdsLive, recordingBus().layer).pipe(Layer.provideMerge(Admin)))
        ) as Effect.Effect<{ readonly _tag: string }, never, never>
    )

    expect(disposition._tag).toBe("Done")
    // The event's own organization won. If this ever reads `event_org_other`, the unscoped lookup has
    // stopped being a lookup and started being an instruction.
    expect(observedOrg).toBe(ORG)
    expect(observedOrg).not.toBe(other)
  })
})
