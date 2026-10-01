/**
 * The price list and quotes.
 *
 * Quote lines COPY the product's price, unit and VAT at drafting time rather than joining to `products`: a price
 * changed next month must not change a quote a customer already holds. `product_id` is kept for tracing, and the
 * catalogue row is never deleted, only deactivated, so that reference always resolves.
 *
 * All amounts are integer cents and quantities integer thousandths, as everywhere money is stored here.
 */
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export const SalesTable = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    create table if not exists products (
      id                text primary key,
      -- No FK to better-auth's organization table; see TenancyTable.ts.
      organization_id   text not null,
      sku               text not null check (length(sku) between 1 and 64),
      name              text not null check (length(name) between 1 and 200),
      unit              text not null check (unit in ('piece', 'hour', 'meter', 'kilogram', 'litre')),
      unit_price_cents  integer not null check (unit_price_cents >= 0),
      vat_per_mille     integer not null check (vat_per_mille in (0, 90, 210)),
      active            boolean not null default true,
      created_at        timestamptz not null default now(),
      updated_at        timestamptz not null default now(),
      unique (organization_id, sku)
    )
  `

  yield* sql`
    create table if not exists quotes (
      id                text primary key,
      organization_id   text not null,
      status            text not null check (status in ('draft', 'approved', 'sent', 'discarded')),
      customer_name     text,
      customer_email    text,
      request           text not null,
      subtotal_cents    integer not null,
      vat_total_cents   integer not null,
      total_cents       integer not null check (total_cents = subtotal_cents + vat_total_cents),
      flags             text[] not null default '{}',
      -- The model that read the request, as the adapter reported it; null when it did not say.
      model             text,
      created_by        text not null,
      created_at        timestamptz not null default now(),
      approved_by       text,
      approved_at       timestamptz,
      sent_at           timestamptz,
      discarded_at      timestamptz
    )
  `

  yield* sql`
    create index if not exists quotes_queue_idx on quotes (organization_id, status, created_at desc)
  `

  yield* sql`
    create table if not exists quote_lines (
      quote_id          text not null references quotes(id) on delete cascade,
      organization_id   text not null,
      ordinal           integer not null,
      product_id        text not null references products(id),
      sku               text not null,
      description       text not null,
      request_text      text not null,
      quantity_milli    integer not null check (quantity_milli > 0),
      unit              text not null,
      unit_price_cents  integer not null,
      vat_per_mille     integer not null,
      line_total_cents  integer not null,
      primary key (quote_id, ordinal)
    )
  `
})

/**
 * Proposed price-list changes (migration 0030). `before`/`after` are the full product fields as JSON, so what a
 * person approves is exactly what is applied, and applying can check the product still equals `before`.
 */
export const ChangeProposalTable = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    create table if not exists change_proposals (
      id               text primary key,
      organization_id  text not null,
      status           text not null check (status in ('pending', 'applied', 'rejected')),
      kind             text not null check (kind in ('update_product', 'create_product')),
      sku              text not null,
      before           jsonb,
      after            jsonb not null,
      instruction      text not null,
      created_by       text not null,
      created_at       timestamptz not null default now(),
      decided_by       text,
      decided_at       timestamptz,
      check ((kind = 'create_product') = (before is null))
    )
  `

  yield* sql`
    create index if not exists change_proposals_pending_idx on change_proposals (organization_id, status, created_at desc)
  `
})
