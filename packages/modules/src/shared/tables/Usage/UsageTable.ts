/**
 * `usage_records` — one row per metered consumption. See `shared/domain/Usage/Usage.ts` for what is metered and
 * why billable units and cost are treated differently.
 *
 * Append-only by intent: nothing in the application updates or deletes a meter row, because an invoice is a sum
 * over these and a mutable row would make last month's invoice unreproducible.
 */
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export const UsageTable = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    create table if not exists usage_records (
      id               bigint generated always as identity primary key,
      -- No FK to better-auth's organization table; see TenancyTable.ts.
      organization_id  text not null,
      -- The closed vocabulary, mirrored from Meter in Usage.ts. Adding a meter is a change in both places.
      meter            text not null check (meter in (
                         'documents.ingested', 'decisions.completed',
                         'model.input_tokens', 'model.output_tokens'
                       )),
      quantity         bigint not null check (quantity > 0),
      model            text,
      subject_id       text,
      idempotency_key  text,
      recorded_at      timestamptz not null default now()
    )
  `

  // A billable unit is counted once however many times its work is retried. Partial, because cost meters
  // deliberately have no key — a re-run model call is real spend.
  yield* sql`
    create unique index if not exists usage_records_idempotency_idx
      on usage_records (organization_id, idempotency_key)
      where idempotency_key is not null
  `

  // Every read is "this organization, this period".
  yield* sql`
    create index if not exists usage_records_period_idx
      on usage_records (organization_id, recorded_at)
  `
})
