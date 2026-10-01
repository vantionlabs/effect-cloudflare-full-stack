/** Reading a quote back from its two tables, tenant-scoped. Shared by every quote use case. */
import type { OrgId } from "@ea/domain/Identity"
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
    sentAt: row.sent_at === null ? null : row.sent_at.toISOString()
  })

const QUOTE_COLUMNS = `id, status, customer_name, customer_email, request, subtotal_cents, vat_total_cents,
  total_cents, flags, created_at, approved_by, sent_at`

/** Quotes by id, with their lines, in the given organization. Missing ids are simply absent. */
export const loadQuotes = (sql: SqlClient.SqlClient, orgId: OrgId, ids: ReadonlyArray<string>) =>
  Effect.gen(function*() {
    if (ids.length === 0) return []
    const rows = yield* sql<QuoteRow>`
      select ${sql.literal(QUOTE_COLUMNS)} from quotes
       where organization_id = ${orgId} and id in ${sql.in(ids)}
       order by created_at desc
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
