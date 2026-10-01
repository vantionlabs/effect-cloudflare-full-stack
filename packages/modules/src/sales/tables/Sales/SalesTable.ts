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

/**
 * After a quote is sent (migration 0031): the customer accepts or declines it, an accepted quote becomes a JOB
 * (work in progress), a finished job is INVOICED, and an invoice is PAID. Every step is a person's action.
 *
 * A job's value and an invoice's amount are copied from the quote's total at the moment they are created, so a
 * later change anywhere cannot rewrite what was agreed or billed — the same rule as quote lines copying prices.
 */
export const WorkTable = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  // Widen quote statuses by the constraint's real name (read from pg_constraint). Expand-only.
  yield* sql`alter table quotes drop constraint if exists quotes_status_check`
  yield* sql`
    alter table quotes add constraint quotes_status_check
      check (status in ('draft', 'approved', 'sent', 'discarded', 'accepted', 'declined'))
  `
  yield* sql`alter table quotes add column if not exists responded_at timestamptz`

  yield* sql`
    create table if not exists jobs (
      id               text primary key,
      organization_id  text not null,
      quote_id         text not null unique references quotes(id),
      customer_name    text,
      status           text not null check (status in ('open', 'done', 'invoiced')),
      value_cents      integer not null check (value_cents >= 0),
      accepted_at      timestamptz not null default now(),
      completed_at     timestamptz,
      created_by       text not null
    )
  `
  yield* sql`create index if not exists jobs_status_idx on jobs (organization_id, status)`

  yield* sql`
    create table if not exists invoices (
      id               text primary key,
      organization_id  text not null,
      job_id           text not null unique references jobs(id),
      customer_name    text,
      amount_cents     integer not null check (amount_cents >= 0),
      issued_on        date not null,
      due_on           date not null check (due_on >= issued_on),
      status           text not null check (status in ('open', 'paid')),
      paid_on          date,
      check ((status = 'paid') = (paid_on is not null))
    )
  `
  yield* sql`create index if not exists invoices_due_idx on invoices (organization_id, status, due_on)`
})

/**
 * One PENDING proposal per identical change (migration 0032).
 *
 * The model issues tool calls concurrently — four identical ones for a single instruction — so a read-then-insert
 * check let all four through, each having looked before any had written. A partial unique index makes the insert
 * itself the claim: concurrent duplicates collapse into one row, and decided proposals are not constrained.
 */
export const ChangeProposalUnique = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  /*
   * Duplicates created before the index existed would make it fail to build — and did, on the local database. Keep
   * the OLDEST pending proposal of each identical set and mark the rest rejected, attributed to this migration so
   * the record says why. Nothing is deleted, and nothing a person decided is touched.
   */
  yield* sql`
    update change_proposals p set status = 'rejected', decided_by = 'migration-0032-duplicate', decided_at = now()
     where p.status = 'pending'
       and exists (
         select 1 from change_proposals q
          where q.status = 'pending' and q.organization_id = p.organization_id and q.kind = p.kind
            and q.sku = p.sku and q.after = p.after
            and (q.created_at, q.id) < (p.created_at, p.id)
       )
  `
  yield* sql`
    create unique index if not exists change_proposals_one_pending_idx
      on change_proposals (organization_id, kind, sku, after)
      where status = 'pending'
  `
})

/**
 * Payment terms per customer (migration 0033), keyed by the customer's EMAIL — the one stable identity a quote
 * carries, since the name is free text. Stored lower-cased so two spellings of one address are one customer.
 *
 * A customer with no row has the default terms (`PAYMENT_TERMS_DAYS`). An invoice copies the terms into its due
 * date when it is issued, so changing a customer's terms later never moves an invoice already sent.
 */
export const CustomerTermsTable = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    create table if not exists customer_terms (
      organization_id  text not null,
      customer_email   text not null check (customer_email = lower(customer_email)),
      terms_days       integer not null check (terms_days between 0 and 365),
      updated_by       text not null,
      updated_at       timestamptz not null default now(),
      primary key (organization_id, customer_email)
    )
  `
})

/**
 * A customer's email becomes a draft quote (migration 0036).
 *
 * - `inbound_addresses`: each organization's receiving address is `<token>@<INBOUND_EMAIL_DOMAIN>`. The token is the
 *   only thing an email carries that names an organization, so it is random, unique, and rotatable: rotating
 *   disables the old one (kept, for the record) and at most one is active per organization.
 * - `inbound_messages`: every message that reached a known address, INCLUDING the refused ones (an auto-reply, the
 *   51st in an hour) — a refusal that leaves no row is a lost customer request nobody can see. `(organization_id,
 *   message_id)` is unique, which is what makes a redelivered or re-sent message a no-op.
 * - `quotes.request_source` / `inbound_message_id`: where a draft came from, and one draft per message at most —
 *   the partial unique index is what makes a redelivered queue event unable to draft twice.
 */
export const InboundEmailTable = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    create table if not exists inbound_addresses (
      token            text primary key,
      organization_id  text not null,
      created_at       timestamptz not null default now(),
      disabled_at      timestamptz
    )
  `
  yield* sql`
    create unique index if not exists inbound_addresses_one_active_idx
      on inbound_addresses (organization_id) where disabled_at is null
  `
  yield* sql`
    create table if not exists inbound_messages (
      id               text primary key,
      organization_id  text not null,
      message_id       text not null,
      from_address     text not null,
      from_name        text,
      subject          text,
      body_text        text not null,
      truncated        boolean not null default false,
      received_at      timestamptz not null default now(),
      status           text not null check (status in ('received', 'drafted', 'failed', 'rejected')),
      quote_id         text,
      reason           text,
      unique (organization_id, message_id)
    )
  `
  yield* sql`
    create index if not exists inbound_messages_recent_idx on inbound_messages (organization_id, received_at desc)
  `
  yield* sql`alter table quotes add column if not exists request_source text not null default 'manual'`
  yield* sql`alter table quotes drop constraint if exists quotes_request_source_check`
  yield* sql`
    alter table quotes add constraint quotes_request_source_check check (request_source in ('manual', 'email'))
  `
  yield* sql`alter table quotes add column if not exists inbound_message_id text`
  yield* sql`
    create unique index if not exists quotes_one_per_inbound_message_idx
      on quotes (organization_id, inbound_message_id) where inbound_message_id is not null
  `
})
