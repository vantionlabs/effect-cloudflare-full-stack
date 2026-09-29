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
import {
  DocumentNotFound,
  EventBus,
  type EventBusService,
  EventId,
  EventSendFailed
} from "@ea/modules/shared/domain/Event"
import { CurrentUser, Identity, OrgId, UserId } from "@ea/modules/shared/domain/Identity"
import { Ids } from "@ea/modules/shared/domain/Ids"
import { Db } from "@ea/modules/shared/tables/Database"
import { ConsumeEvent, EmitEvent } from "@ea/modules/shared/use-cases/Event"
import { PgClient } from "@effect/sql-pg"
import { Effect, Layer, Redacted } from "effect"
import { SqlClient } from "effect/sql"
import { beforeEach, describe, expect, it } from "vitest"

const ORG = OrgId.make("event_org")

const Admin = PgClient.layer({
  host: "localhost",
  port: 55433,
  username: "effect_ai",
  password: Redacted.make("local_dev_only"),
  database: "effect_ai",
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
      Effect.provide(Layer.mergeAll(Db.layer, IdsLive, bus)),
      Effect.provide(Admin)
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

  it("scopes events to the caller's organization", async () => {
    const { eventId } = await emit("c5")
    const other = new Identity({
      userId: UserId.make("u2"),
      orgId: OrgId.make("event_org_other"),
      email: "o@example.com",
      role: "reviewer"
    })

    const disposition = await Effect.runPromise(
      ConsumeEvent(eventId, () => Effect.void).pipe(
        Effect.provideService(CurrentUser, other),
        Effect.provide(Layer.mergeAll(Db.layer, IdsLive, recordingBus().layer)),
        Effect.provide(Admin)
      ) as Effect.Effect<{ readonly _tag: string }, never, never>
    )

    // RLS hides the row, so it reads as absent rather than as someone else's work.
    expect(disposition._tag).toBe("Terminal")
  })
})
