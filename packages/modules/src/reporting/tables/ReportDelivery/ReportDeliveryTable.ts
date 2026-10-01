/**
 * `report_deliveries` — one row per organization, report and period: the claim that makes a report go out ONCE.
 *
 * The sender inserts the row before sending, `on conflict do nothing returning`; zero rows back means another run
 * already owns this week, and it stops. So a cron that fires twice, or a retried invocation, cannot email a
 * manager the same figures twice. The cost of claim-then-send is the mirror case — a send that fails after the
 * claim is not retried automatically — and `sent_at` staying null is what makes that visible.
 */
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export const ReportDeliveryTable = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    create table if not exists report_deliveries (
      -- No FK to better-auth's organization table; see TenancyTable.ts.
      organization_id  text not null,
      report           text not null check (report in ('weekly')),
      period_start     date not null,
      claimed_at       timestamptz not null default now(),
      -- Null after claiming and before the sends finish; null for good means the send failed part way.
      sent_at          timestamptz,
      recipients       integer,
      primary key (organization_id, report, period_start)
    )
  `
})
