/**
 * The Monday job against real Postgres: who gets an email, what it says, and that it goes out once.
 *
 * Two organizations: one active last week (an intake, two decisions), one idle. The properties that matter are the
 * ones a manager would notice going wrong — being emailed twice, an idle account being emailed at all, a member
 * who is not an owner or admin receiving figures, or a figure from outside the week.
 */
import { Db } from "@ea/database/Database"
import { SendWeeklyReports } from "@ea/modules/reporting/use-cases/WeeklyReport"
import { Email, type EmailMessage } from "@ea/modules/shared/domain/Email"
import { PgClient } from "@effect/sql-pg"
import { Effect, Layer, Redacted } from "effect"
import { SqlClient } from "effect/sql"
import { beforeEach, describe, expect, it } from "vitest"

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

const ACTIVE = "weekly_org_active"
const IDLE = "weekly_org_idle"
// Monday 06:00 UTC: the report covers 2026-09-28 .. 2026-10-05.
const NOW = new Date("2026-10-05T06:00:00Z")
const IN_WEEK = "2026-09-30T10:00:00Z"
const BEFORE_WEEK = "2026-09-20T10:00:00Z"

const sendWith = (now: Date) => {
  const sent: Array<EmailMessage> = []
  const capture = Layer.succeed(Email)({ send: (message) => Effect.sync(() => void sent.push(message)) })
  return Effect.runPromise(
    SendWeeklyReports(now).pipe(Effect.provide(Layer.mergeAll(Db.layer, capture).pipe(Layer.provideMerge(Admin))))
  ).then((summary) => ({ summary, sent }))
}

beforeEach(async () => {
  await asAdmin(Effect.flatMap(SqlClient.SqlClient, (sql) =>
    Effect.gen(function*() {
      for (const org of [ACTIVE, IDLE]) {
        yield* sql`delete from report_deliveries where organization_id = ${org}`
        yield* sql`delete from usage_records where organization_id = ${org}`
        yield* sql`delete from decisions where organization_id = ${org}`
        yield* sql`delete from intakes where organization_id = ${org}`
        yield* sql`delete from source_documents where organization_id = ${org}`
        yield* sql`delete from member where "organizationId" = ${org}`
        yield* sql`delete from organization where id = ${org}`
      }
      yield* sql`delete from "user" where id in ('weekly_owner', 'weekly_admin', 'weekly_member', 'weekly_idle_owner')`

      // People and organizations, as better-auth stores them.
      for (
        const [id, email] of [
          ["weekly_owner", "owner@workshop.test"],
          ["weekly_admin", "admin@workshop.test"],
          ["weekly_member", "member@workshop.test"],
          ["weekly_idle_owner", "idle@workshop.test"]
        ]
      ) {
        yield* sql`insert into "user" (id, name, email, "createdAt", "updatedAt") values (${id}, ${id}, ${email}, now(), now())`
      }
      yield* sql`insert into organization (id, name, slug, "createdAt") values (${ACTIVE}, 'Been Hydrauliek', ${ACTIVE}, now())`
      yield* sql`insert into organization (id, name, slug, "createdAt") values (${IDLE}, 'Idle BV', ${IDLE}, now())`
      for (
        const [id, org, user, role] of [
          ["wm1", ACTIVE, "weekly_owner", "owner"],
          ["wm2", ACTIVE, "weekly_admin", "admin"],
          ["wm3", ACTIVE, "weekly_member", "member"],
          ["wm4", IDLE, "weekly_idle_owner", "owner"]
        ]
      ) {
        yield* sql`insert into member (id, "organizationId", "userId", role, "createdAt") values (${id}, ${org}, ${user}, ${role}, now())`
      }

      // The active organization's week: one intake, two decisions inside it, and one of each outside it.
      for (const [doc, at] of [["wk_doc_in", IN_WEEK], ["wk_doc_out", BEFORE_WEEK]]) {
        yield* sql`
          insert into source_documents (id, organization_id, collection, filename, r2_key, content_type)
          values (${doc}, ${ACTIVE}, 'transactional', 'f.md', ${doc}, 'text/markdown')
        `
        yield* sql`
          insert into intakes (id, organization_id, source, document_id, received_at)
          values (${`i_${doc}`}, ${ACTIVE}, 'upload', ${doc}, ${at}::timestamptz)
        `
      }
      for (
        const [id, outcome, status, at] of [
          ["wk_d1", "auto_approve", "auto_approved", IN_WEEK],
          ["wk_d2", "needs_human", "pending_review", IN_WEEK],
          ["wk_d3", "reject", "rejected", BEFORE_WEEK]
        ]
      ) {
        yield* sql`
          insert into decisions (
            id, organization_id, document_id, vertical, decide_key, outcome, status, rationale,
            retrieval_mode, grounded, model, decided_at
          ) values (
            ${id}, ${ACTIVE}, 'wk_doc_in', 'invoice', ${`k_${id}`}, ${outcome}, ${status}, 'r',
            'hybrid', true, 'm', ${at}::timestamptz
          )
        `
      }
      yield* sql`
        insert into usage_records (organization_id, meter, quantity, model, recorded_at)
        values (${ACTIVE}, 'model.input_tokens', 1500, 'm1', ${IN_WEEK}::timestamptz),
               (${ACTIVE}, 'model.output_tokens', 300, 'm1', ${IN_WEEK}::timestamptz)
      `
    })))
})

describe("the weekly report", () => {
  it("emails the active organization's owners and admins — not its members, not the idle organization", async () => {
    const { sent } = await sendWith(NOW)
    const ours = sent.filter((message) => message.subject.startsWith("Been Hydrauliek"))
    expect(ours.map((message) => message.to).sort()).toEqual(["admin@workshop.test", "owner@workshop.test"])
    expect(sent.some((message) => message.to === "idle@workshop.test")).toBe(false)
    expect(sent.some((message) => message.to === "member@workshop.test")).toBe(false)
  })

  it("counts only the week it covers, and reports the backlog as it is now", async () => {
    const { sent } = await sendWith(NOW)
    const text = sent.find((message) => message.to === "owner@workshop.test")!.text
    expect(text).toContain("2026-09-28 to 2026-10-05")
    expect(text).toContain("Documents received:        1")
    expect(text).toContain("Decisions made:            2")
    expect(text).toContain("approved automatically:  1 (50%)")
    expect(text).toContain("needed a person:         1 (50%)")
    expect(text).toContain("rejected:                0")
    expect(text).toContain("Waiting for review now:    1")
    expect(text).toContain("m1: 1,500 / 300")
  })

  it("goes out ONCE: a second run in the same week sends nothing and says why", async () => {
    await sendWith(NOW)
    const again = await sendWith(new Date("2026-10-05T06:05:00Z"))
    expect(again.sent.filter((message) => message.subject.startsWith("Been Hydrauliek"))).toEqual([])
    expect(again.summary.alreadySent).toBeGreaterThanOrEqual(1)

    const [delivery] = await asAdmin(
      Effect.flatMap(SqlClient.SqlClient, (sql) =>
        sql<{ recipients: number; sent: boolean }>`
        select recipients, sent_at is not null as sent from report_deliveries
         where organization_id = ${ACTIVE} and period_start = '2026-09-28'
      `)
    )
    expect(delivery).toEqual({ recipients: 2, sent: true })
  })
})
