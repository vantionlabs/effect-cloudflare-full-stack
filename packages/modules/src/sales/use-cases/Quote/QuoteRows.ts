/** Reading a quote back from its two tables, tenant-scoped. Shared by every quote use case. */
import type { OrgId } from "@ea/domain/Identity"
import { QuoteSource } from "@ea/modules/sales/domain/Inbound"
import { ProductId, type Unit } from "@ea/modules/sales/domain/Product"
import { Quote, QuoteId, QuoteLine, type QuoteStatus } from "@ea/modules/sales/domain/Quote"
import { Cents, Milli, PerMille } from "@ea/modules/shared/domain/Money"
import { Effect } from "effect"
import type { SqlClient } from "effect/sql"

interface QuoteRow {
  id: string
  status: QuoteStatus
  customer_name: string | null
  customer_email: string | null
  request: string
  subtotal_cents: number
  vat_total_cents: number
  total_cents: number
  flags: ReadonlyArray<string>
  created_at: Date
  approved_by: string | null
  sent_at: Date | null
  inbound_message_id: string | null
  source_from_address: string | null
  source_from_name: string | null
  source_subject: string | null
}

interface LineRow {
  quote_id: string
  product_id: string
  sku: string
  description: string
  request_text: string
  quantity_milli: number
  unit: Unit
  unit_price_cents: number
  vat_per_mille: number
  line_total_cents: number
}

const toQuote = (row: QuoteRow, lines: ReadonlyArray<LineRow>): Quote =>
  new Quote({
    id: QuoteId.make(row.id),
    status: row.status,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    request: row.request,
    lines: lines.map((line) =>
      new QuoteLine({
        productId: ProductId.make(line.product_id),
        sku: line.sku,
        description: line.description,
        requestText: line.request_text,
        quantity: Milli.make(line.quantity_milli),
        unit: line.unit,
        unitPrice: Cents.make(line.unit_price_cents),
        vat: PerMille.make(line.vat_per_mille),
        lineTotal: Cents.make(line.line_total_cents)
      })
    ),
    subtotal: Cents.make(row.subtotal_cents),
    vatTotal: Cents.make(row.vat_total_cents),
    total: Cents.make(row.total_cents),
    flags: row.flags,
    createdAt: row.created_at.toISOString(),
    approvedBy: row.approved_by,
    sentAt: row.sent_at === null ? null : row.sent_at.toISOString(),
    source: row.inbound_message_id === null || row.source_from_address === null
      ? null
      : new QuoteSource({
        inboundMessageId: row.inbound_message_id,
        fromAddress: row.source_from_address,
        fromName: row.source_from_name,
        subject: row.source_subject
      })
  })

const QUOTE_COLUMNS = `q.id, q.status, q.customer_name, q.customer_email, q.request, q.subtotal_cents,
  q.vat_total_cents, q.total_cents, q.flags, q.created_at, q.approved_by, q.sent_at, q.inbound_message_id,
  m.from_address as source_from_address, m.from_name as source_from_name, m.subject as source_subject`

/** Quotes by id, with their lines, in the given organization. Missing ids are simply absent. */
export const loadQuotes = (sql: SqlClient.SqlClient, orgId: OrgId, ids: ReadonlyArray<string>) =>
  Effect.gen(function*() {
    if (ids.length === 0) return []
    // The email a draft came from, when it came from one. Scoped on BOTH tables: the join must not be a way to read
    // another organization's message, however the id got there.
    const rows = yield* sql<QuoteRow>`
      select ${sql.literal(QUOTE_COLUMNS)} from quotes q
        left join inbound_messages m on m.id = q.inbound_message_id and m.organization_id = ${orgId}
       where q.organization_id = ${orgId} and q.id in ${sql.in(ids)}
       order by q.created_at desc
    `
    const lines = yield* sql<LineRow>`
      select quote_id, product_id, sku, description, request_text, quantity_milli, unit, unit_price_cents,
             vat_per_mille, line_total_cents
        from quote_lines
       where organization_id = ${orgId} and quote_id in ${sql.in(ids)}
       order by quote_id, ordinal
    `
    return rows.map((row) => toQuote(row, lines.filter((line) => line.quote_id === row.id)))
  })
