/**
 * Keyset paging over the review queue, against real Postgres.
 *
 * Two of these assertions are the entire reason the paging is keyed rather than offset, and neither can be seen
 * without a database:
 *
 * - **A tie on the sort column.** The queue orders by `decided_at`, and two decisions can share a timestamp to
 *   the microsecond when a batch is decided together. With `order by decided_at` alone, the page boundary
 *   between two tied rows is whatever the planner felt like, so one row appears on both pages or on neither.
 *   The fix is that `d.id` is part of both the sort and the cursor; this file is what says so.
 * - **Drift.** The queue is written to constantly. Offset paging on a table that grows shows a row twice or
 *   skips one, and the symptom in production is a reviewer who processed the same decision twice.
 */
import { Db } from "@ea/database/Database"
import { CurrentOrg, CurrentUser, Identity, OrgId, UserId } from "@ea/domain/Identity"
import { ListQueue } from "@ea/modules/decision/use-cases/Decision"
import { PgClient } from "@effect/sql-pg"
import { Effect, Layer, Redacted } from "effect"
import { SqlClient } from "effect/sql"
import { beforeEach, describe, expect, it } from "vitest"

const ORG = OrgId.make("queue_org")
const OTHER = OrgId.make("queue_org_other")

const Admin = PgClient.layer({
  host: process.env["PGHOST"] ?? "localhost",
  port: Number(process.env["PGPORT"] ?? 55433),
  username: process.env["PGUSER"] ?? "effect_ai",
  password: Redacted.make(process.env["PGPASSWORD"] ?? "local_dev_only"),
  database: process.env["PGDATABASE"] ?? "effect_ai",
  ssl: false
})

const identity = new Identity({
  userId: UserId.make("queue_user"),
  orgId: ORG,
  email: "r@example.test",
  role: "reviewer"
})

const run = <A, E>(effect: Effect.Effect<A, E, any>, org: OrgId = ORG) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provideService(CurrentUser, org === ORG ? identity : { ...identity, orgId: org } as Identity),
      Effect.provideService(CurrentOrg, org),
      Effect.provide(Db.layer.pipe(Layer.provideMerge(Admin)))
    ) as Effect.Effect<A, E, never>
  )

const asAdmin = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(Admin)) as Effect.Effect<A, E, never>)

/**
 * A decision in `pending_review`, with `decided_at` and the id both given explicitly.
 *
 * Both are parameters because the cases below are about the relationship between them: a shared timestamp with
 * differing ids is the tie case, and an id ordering that disagrees with the timestamp ordering is what a
 * cursor keyed on the wrong column would get wrong.
 */
const seed = (
  options: { readonly id: string; readonly decidedAt: string; readonly org?: OrgId; readonly intake?: string }
) =>
  asAdmin(Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const org = options.org ?? ORG
    const documentId = `${options.id}_doc`
    yield* sql`
      insert into source_documents (id, organization_id, collection, filename, r2_key, content_type)
      values (${documentId}, ${org}, 'transactional', ${`${options.id}.md`},
              ${`${org}/${documentId}`}, 'text/markdown')
    `
    if (options.intake !== undefined) {
      yield* sql`
        insert into intakes (id, organization_id, document_id, source, received_at)
        values (${options.intake}, ${org}, ${documentId}, 'upload', now())
      `
    }
    yield* sql`
      insert into decisions (
        id, organization_id, document_id, vertical, decide_key, outcome, status, rationale,
        retrieval_mode, grounded, model, decided_at
      ) values (
        ${options.id}, ${org}, ${documentId}, 'invoice', ${`decision:${options.id}:invoice`},
        'route_for_approval', 'pending_review', 'because', 'hybrid', true, 'scripted',
        ${options.decidedAt}::timestamptz
      )
    `
  }))

/** The cursor for the last row of a page, in the order `ListQueue` sorts by. */
const cursorOf = (items: ReadonlyArray<{ readonly decidedAt: string; readonly decisionId: string }>) => {
  const last = items[items.length - 1]
  if (last === undefined) throw new Error("no page to take a cursor from")
  return [last.decidedAt, last.decisionId] as const
}

beforeEach(async () => {
  await asAdmin(Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    // Decisions and intakes both cascade from source_documents.
    yield* sql`delete from source_documents where organization_id in (${ORG}, ${OTHER})`
  }))
})

describe("ListQueue paging", () => {
  it("walks the whole collection exactly once across pages", async () => {
    for (let i = 0; i < 5; i = i + 1) {
      await seed({ id: `q_${i}`, decidedAt: `2026-09-01T10:0${i}:00Z` })
    }

    const seen: Array<string> = []
    let after: readonly [string, string] | undefined
    for (let page = 0; page < 10; page = page + 1) {
      const items = await run(ListQueue({ limit: 2, after }))
      if (items.length === 0) break
      seen.push(...items.map((item) => item.decisionId))
      if (items.length < 2) break
      after = cursorOf(items)
    }

    expect(seen).toEqual(["q_0", "q_1", "q_2", "q_3", "q_4"])
    expect(new Set(seen).size).toBe(seen.length)
  })

  /*
   * The tie. All three share a timestamp, so `order by decided_at` alone leaves the boundary undefined — and
   * the bug it produces is invisible on a small table and intermittent on a large one.
   */
  it("breaks a tie on decided_at by id, so a page boundary is still exact", async () => {
    const same = "2026-09-02T09:00:00Z"
    for (const id of ["q_tie_c", "q_tie_a", "q_tie_b"]) await seed({ id, decidedAt: same })

    const first = await run(ListQueue({ limit: 2 }))
    const second = await run(ListQueue({ limit: 2, after: cursorOf(first) }))

    expect(first.map((item) => item.decisionId)).toEqual(["q_tie_a", "q_tie_b"])
    expect(second.map((item) => item.decisionId)).toEqual(["q_tie_c"])
  })

  /*
   * Drift. A decision arrives between two requests — which is the normal state of a queue, not an edge case.
   * Keyed paging cannot repeat a row because the cursor names a position in the ORDER, not a count of rows
   * skipped. The queue is oldest-first, so a newer arrival lands on a later page, and the row that would have
   * been shifted by an offset is untouched.
   */
  it("does not repeat or skip a row when the queue grows between pages", async () => {
    for (let i = 0; i < 4; i = i + 1) {
      await seed({ id: `q_drift_${i}`, decidedAt: `2026-09-03T10:0${i}:00Z` })
    }

    const first = await run(ListQueue({ limit: 2 }))
    expect(first.map((item) => item.decisionId)).toEqual(["q_drift_0", "q_drift_1"])

    // Arrives while the reviewer is on page one, and earlier than the remaining rows.
    await seed({ id: "q_drift_late", decidedAt: "2026-09-03T10:01:30Z" })

    const second = await run(ListQueue({ limit: 2, after: cursorOf(first) }))
    // The new row sorts after the cursor, so it appears — and nothing already seen comes back.
    expect(second.map((item) => item.decisionId)).toEqual(["q_drift_late", "q_drift_2"])
    expect(second.map((item) => item.decisionId)).not.toContain("q_drift_1")
  })

  it("narrows to one intake, which is how a client polls for what it just uploaded", async () => {
    await seed({ id: "q_mine", decidedAt: "2026-09-04T10:00:00Z", intake: "intake_mine" })
    await seed({ id: "q_theirs", decidedAt: "2026-09-04T10:01:00Z", intake: "intake_theirs" })

    const items = await run(ListQueue({ intakeId: "intake_mine" }))
    expect(items.map((item) => item.decisionId)).toEqual(["q_mine"])
  })

  it("cannot be pointed at another organization's intake", async () => {
    // The intake id is a caller-supplied string, so the filter has to be tenant-scoped in its own right:
    // `Db.scoped` bounds the decisions, and the `exists` clause must bound the intake the same way or the
    // filter becomes an oracle for whether an id exists elsewhere.
    await seed({ id: "q_other", decidedAt: "2026-09-05T10:00:00Z", org: OTHER, intake: "intake_other" })
    await seed({ id: "q_own", decidedAt: "2026-09-05T10:01:00Z", intake: "intake_own" })

    expect(await run(ListQueue({ intakeId: "intake_other" }))).toEqual([])
  })
})
