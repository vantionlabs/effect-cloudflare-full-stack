/**
 * The stuck-work report, against real Postgres — and the assertion that matters is that it changes nothing.
 *
 * ADR-0013 is unambiguous: _"a cron REPORTS stuck claims to an operator view and must not resolve them."_
 * An ambiguous `pending` execution may mean the adapter call SUCCEEDED and only the recording write was
 * lost, and no transaction can tell you which, because the outbound call happens outside any database. A
 * sweeper that "recovered" one would pay a supplier twice. So the restraint is the feature, and a test that
 * only counted rows would pass just as happily on a version that retried them.
 */
import { Db } from "@ea/database/Database"
import { OrgId } from "@ea/domain/Identity"
import { ReportStuckWork } from "@ea/modules/decision/use-cases/Execution"
import { PgClient } from "@effect/sql-pg"
import { Effect, Layer, Redacted } from "effect"
import { SqlClient } from "effect/sql"
import { beforeEach, describe, expect, it } from "vitest"

const ORG = OrgId.make("stuck_org")

const Admin = PgClient.layer({
  host: process.env["PGHOST"] ?? "localhost",
  port: Number(process.env["PGPORT"] ?? 55433),
  username: process.env["PGUSER"] ?? "effect_ai",
  password: Redacted.make(process.env["PGPASSWORD"] ?? "local_dev_only"),
  database: process.env["PGDATABASE"] ?? "effect_ai",
  ssl: false
})

const asAdmin = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(Admin)) as Effect.Effect<A, E, never>)

/**
 * The reporter needs NO tenant, which is the point of running it this way.
 *
 * `unscopedForCron` is the licensed cross-tenant read, and a cron has no organization — so if this ever
 * started requiring `CurrentOrg`, it would mean the implementation had stopped being usable from a cron.
 */
const report = () =>
  Effect.runPromise(
    /*
     * `Db.layer` over the admin client directly, with no `withDatabase`.
     *
     * `withDatabase` supplies `Connect`, which is the Worker's per-invocation Hyperdrive socket — there is
     * no such thing here, and the `tables` suite's whole shape is "the real SQL against a real database
     * with the connection handed in". Same as every other test in this directory.
     */
    ReportStuckWork.pipe(
      Effect.provide(Db.layer.pipe(Layer.provideMerge(Admin)))
    ) as unknown as Effect.Effect<
      {
        readonly executions: ReadonlyArray<{ readonly id: string }>
        readonly events: ReadonlyArray<{ readonly id: string; readonly workflowInstanceId: string | null }>
        readonly more: boolean
      },
      never,
      never
    >
  )

/**
 * How far back a "stuck" fixture is dated: ten years, not thirty minutes.
 *
 * The report reads ACROSS tenants, oldest first, capped at `MAX_PER_TICK` — so whether our row appears depends
 * on how many older stuck rows OTHER suites have left in the shared database. Membership assertions fixed the
 * count problem and not this one: with 67 abandoned `processing` events from 50 other orgs, a fixture dated 30
 * minutes ago sorted past the cap and the test failed with `expected [ …(50) ] to include 'v_1'`.
 *
 * Dating ours older than anything a real run produces puts it on the first page whatever else is there, which
 * is the property the test needs. Cleaning up other suites' rows would also work, today, until one forgot.
 */
const ANCIENT = 60 * 24 * 365 * 10

const DOCUMENT = "stuck_doc"

/**
 * A document and a decision for the execution to hang off.
 *
 * `executions.decision_id` has a foreign key, and `decisions.document_id` another — found by seeding an
 * execution alone and getting `executions_decision_id_fkey`. Worth keeping the chain explicit: the
 * constraints are what make an orphaned execution impossible, so a test that worked around them would be
 * testing a state the database forbids.
 */
const seedDecision = (id: string) =>
  asAdmin(
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      Effect.gen(function*() {
        yield* sql`
          insert into source_documents (id, organization_id, collection, filename, r2_key, content_type)
          values (${DOCUMENT}, ${ORG}, 'transactional', 'f.md', ${`${ORG}/${DOCUMENT}`}, 'text/markdown')
          on conflict (id) do nothing
        `
        yield* sql`
          insert into decisions (
            id, organization_id, document_id, vertical, decide_key, outcome, status, rationale,
            retrieval_mode, grounded, model
          ) values (
            ${id}, ${ORG}, ${DOCUMENT}, 'invoice', ${`decision:${id}:invoice`}, 'route_for_approval',
            'pending_review', 'because', 'hybrid', true, 'scripted'
          )
          on conflict (id) do nothing
        `
      }))
  )

/** `claimed_at`/`started_at` are set in the PAST, because "stuck" is defined by age. */
const seedStuckExecution = (id: string, minutesAgo: number) =>
  asAdmin(
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      sql`
        insert into executions (
          id, organization_id, decision_id, action, idempotency_key, provider_idempotency_key,
          status, claimed_at
        ) values (
          ${id}, ${ORG}, ${`dec_${id}`}, 'dry_run', ${`k_${id}`}, ${`p_${id}`},
          'pending', now() - interval '${sql.literal(String(minutesAgo))} minutes'
        )
      `)
  )

const seedStuckEvent = (id: string, minutesAgo: number, instance: string | null) =>
  asAdmin(
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      sql`
        insert into events (
          id, organization_id, type, idempotency_key, payload, status, started_at, workflow_instance_id
        ) values (
          ${id}, ${ORG}, 'document.decide', ${`ek_${id}`}, '{}'::jsonb, 'processing',
          now() - interval '${sql.literal(String(minutesAgo))} minutes', ${instance}
        )
      `)
  )

const statusesOf = (table: "executions" | "events") =>
  asAdmin(
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      table === "executions"
        ? sql<{ id: string; status: string }>`
            select id, status from executions where organization_id = ${ORG} order by id
          `
        : sql<{ id: string; status: string }>`
            select id, status from events where organization_id = ${ORG} order by id
          `)
  )

beforeEach(async () => {
  await asAdmin(
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      Effect.gen(function*() {
        yield* sql`delete from executions where organization_id = ${ORG}`
        yield* sql`delete from events where organization_id = ${ORG}`
        yield* sql`delete from decisions where organization_id = ${ORG}`
        yield* sql`delete from source_documents where organization_id = ${ORG}`
      }))
  )
})

describe("what counts as stuck", () => {
  it("reports a pending execution older than the grace period", async () => {
    await seedDecision("dec_e_old")
    await seedStuckExecution("e_old", ANCIENT)
    /*
     * Membership, not a count. The read is cross-tenant BY DESIGN — "which tenants have stuck work" is the
     * question — so a count is a property of the whole database, including whatever other suites are doing
     * in parallel. Asserting on our own id is the only form that is immune to that, and the first version
     * of this test failed with `expected 45 to be 1` for exactly that reason.
     */
    expect((await report()).executions.map((row) => row.id)).toContain("e_old")
  })

  it("ignores one inside the grace period, because in-flight work is not stuck work", async () => {
    /*
     * The grace period is 15 minutes precisely so a legitimately slow pipeline — a decide run with an OCR
     * call in it — is not reported. A report that cried about healthy work would stop being read, which is
     * the failure mode the whole file is written against.
     */
    await seedDecision("dec_e_new")
    await seedStuckExecution("e_new", 2)
    expect((await report()).executions.map((row) => row.id)).not.toContain("e_new")
  })

  it("reports an event whose Workflow instance never came back", async () => {
    // The state the queue flip created: `processing`, an instance id, and nothing that will ever finish it.
    await seedStuckEvent("v_wf", ANCIENT, "event-v_wf")
    const found = (await report()).events.find((row) => row.id === "v_wf")
    expect(found).toBeDefined()
    // The id is the point of reporting it: an operator runs `wrangler workflows instances describe` on it.
    expect(found!.workflowInstanceId).toBe("event-v_wf")
  })

  it("reports an event stuck with no instance at all", async () => {
    // The inline path — `decision.execute` — dying between the status write and the ack.
    await seedStuckEvent("v_inline", ANCIENT, null)
    const found = (await report()).events.find((row) => row.id === "v_inline")
    expect(found).toBeDefined()
    expect(found!.workflowInstanceId).toBeNull()
  })
})

describe("the restraint, which is the design", () => {
  it("changes NOTHING it reports", async () => {
    /*
     * The assertion ADR-0013 actually demands. A version of this that retried an ambiguous claim would
     * pass every count above — so the counts are not the test. These statuses are.
     */
    await seedDecision("dec_e_1")
    await seedStuckExecution("e_1", ANCIENT)
    await seedStuckEvent("v_1", ANCIENT, "event-v_1")

    const before = { executions: await statusesOf("executions"), events: await statusesOf("events") }
    const summary = await report()
    const after = { executions: await statusesOf("executions"), events: await statusesOf("events") }

    expect(summary.executions.map((row) => row.id)).toContain("e_1")
    expect(summary.events.map((row) => row.id)).toContain("v_1")
    expect(after).toEqual(before)
    // Said twice on purpose: `pending` and `processing` must survive being looked at.
    expect(after.executions[0]!.status).toBe("pending")
    expect(after.events[0]!.status).toBe("processing")
  })
})
