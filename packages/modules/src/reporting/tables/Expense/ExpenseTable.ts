/**
 * `expenses` — money the organization expects to pay out (migration 0034), so the cash forecast can show what goes
 * out beside what comes in.
 *
 * An expense is paid ONCE on `starts_on`, or MONTHLY on that day of the month (the last day, in shorter months).
 * Stopping a monthly expense sets `stopped_on`; nothing is deleted, so a forecast that counted it can be explained
 * afterwards. Amounts are integer cents, VAT included — the amount that actually leaves the account.
 */
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export const ExpenseTable = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    create table if not exists expenses (
      id               text primary key,
      organization_id  text not null,
      description      text not null check (length(description) between 1 and 200),
      amount_cents     integer not null check (amount_cents > 0),
      starts_on        date not null,
      repeat           text not null check (repeat in ('once', 'monthly')),
      stopped_on       date,
      created_by       text not null,
      created_at       timestamptz not null default now()
    )
  `
  yield* sql`create index if not exists expenses_org_idx on expenses (organization_id, stopped_on)`
})
