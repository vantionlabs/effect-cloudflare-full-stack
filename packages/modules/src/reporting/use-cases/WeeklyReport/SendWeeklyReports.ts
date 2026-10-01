/**
 * The Monday job: every organization that was active last week gets its figures by email, once.
 *
 * Three steps, and only the first crosses tenants:
 *
 * 1. **Which organizations** — the one licensed cross-tenant read (`unscopedForCron`), selecting IDS only, as
 *    `Db.ts` requires. Only organizations with intakes or decisions in the period: an idle account gets no email,
 *    which is the difference between a report and spam.
 * 2. **Claim the week** — per organization, `insert … on conflict do nothing returning` into `report_deliveries`.
 *    Zero rows back means another run already owns it, so a cron fired twice sends nothing twice.
 * 3. **Compute, render, send** — tenant-scoped (`CurrentOrg` provided per organization), to the organization's
 *    owners and admins, through the `Email` port: Resend when configured, the console stub otherwise.
 *
 * One organization failing does not stop the others; it is logged and the loop continues.
 */
import { Db } from "@ea/database/Database"
import { CurrentOrg, OrgId } from "@ea/domain/Identity"
import { previousWeek, renderWeeklyReport, type WeekPeriod } from "@ea/modules/reporting/domain/WeeklyReport"
import { Email } from "@ea/modules/shared/domain/Email"
import { Effect } from "effect"
import { ComputeWeeklyKpis } from "./ComputeWeeklyKpis.ts"

/** A bound on one run, so a large tenant count cannot turn one cron invocation into an unbounded one. */
const MAX_ORGANIZATIONS = 500

export interface WeeklyReportSummary {
  readonly period: WeekPeriod
  readonly sent: number
  readonly alreadySent: number
  readonly failed: number
}

/** Owners and admins, by email, and the organization's display name — better-auth's tables, read tenant-scoped. */
const audienceOf = Effect.gen(function*() {
  const db = yield* Db
  return yield* db.scopedForOrg((sql, orgId) =>
    Effect.gen(function*() {
      const [org] = yield* sql<{ name: string }>`select name from organization where id = ${orgId}`
      const people = yield* sql<{ email: string }>`
        select u.email from member m join "user" u on u.id = m."userId"
         where m."organizationId" = ${orgId} and m.role in ('owner', 'admin')
         order by u.email
      `
      return { name: org?.name ?? "your organization", emails: people.map((row) => row.email) }
    })
  )
})

const claimWeek = (period: WeekPeriod) =>
  Effect.flatMap(Db, (db) =>
    db.scopedForOrg((sql, orgId) =>
      Effect.map(
        sql<{ organization_id: string }>`
          insert into report_deliveries (organization_id, report, period_start)
          values (${orgId}, 'weekly', ${period.from}::date)
          on conflict (organization_id, report, period_start) do nothing
          returning organization_id
        `,
        (rows) => rows.length > 0
      )
    ))

const markSent = (period: WeekPeriod, recipients: number) =>
  Effect.flatMap(Db, (db) =>
    db.scopedForOrg((sql, orgId) =>
      sql`
        update report_deliveries set sent_at = now(), recipients = ${recipients}
         where organization_id = ${orgId} and report = 'weekly' and period_start = ${period.from}::date
      `
    ))

/** Sends one organization's report. `true` when it went out, `false` when this week was already claimed. */
const sendFor = (period: WeekPeriod) =>
  Effect.gen(function*() {
    if (!(yield* claimWeek(period))) return false
    const kpis = yield* ComputeWeeklyKpis(period)
    const audience = yield* audienceOf
    const message = renderWeeklyReport(audience.name, kpis)
    const email = yield* Email
    let delivered = 0
    for (const to of audience.emails) {
      // One recipient's failure does not cost the others theirs. `_tag` first: see AGENTS.md on TaggedError.
      const ok = yield* email.send({ to, subject: message.subject, text: message.text }).pipe(
        Effect.as(true),
        Effect.catch((failure) =>
          Effect.as(
            Effect.logWarning(`weekly report not sent: ${failure._tag}`).pipe(Effect.annotateLogs({ to })),
            false
          )
        )
      )
      if (ok) delivered++
    }
    yield* markSent(period, delivered)
    return true
  })

export const SendWeeklyReports = (now: Date) =>
  Effect.gen(function*() {
    const db = yield* Db
    const period = previousWeek(now)
    const active = yield* db.unscopedForCron((sql) =>
      sql<{ organization_id: string }>`
        -- tenant: the organization is the answer
        select organization_id from intakes
         where received_at >= (${period.from}::date::timestamp at time zone 'UTC')
           and received_at <  (${period.to}::date::timestamp at time zone 'UTC')
        union
        select organization_id from decisions
         where decided_at >= (${period.from}::date::timestamp at time zone 'UTC')
           and decided_at <  (${period.to}::date::timestamp at time zone 'UTC')
        order by organization_id
        limit ${MAX_ORGANIZATIONS}
      `
    )

    let sent = 0
    let alreadySent = 0
    let failed = 0
    for (const { organization_id } of active) {
      const outcome = yield* Effect.exit(
        sendFor(period).pipe(Effect.provideService(CurrentOrg, OrgId.make(organization_id)))
      )
      if (outcome._tag === "Failure") {
        failed++
        yield* Effect.logError("weekly report failed").pipe(Effect.annotateLogs({ organizationId: organization_id }))
      } else if (outcome.value) sent++
      else alreadySent++
    }
    return { period, sent, alreadySent, failed } satisfies WeeklyReportSummary
  })
