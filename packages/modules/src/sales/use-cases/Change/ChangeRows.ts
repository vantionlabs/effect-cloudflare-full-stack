/** Reading proposals back, tenant-scoped. */
import type { OrgId } from "@ea/domain/Identity"
import { ChangeId, type ChangeStatus, type ProductFields, ProposedChange } from "@ea/modules/sales/domain/Change"
import { Effect } from "effect"
import type { SqlClient } from "effect/sql"

interface ChangeRow {
  id: string
  status: ChangeStatus
  kind: "update_product" | "create_product"
  sku: string
  before: ProductFields | null
  after: ProductFields
  instruction: string
  created_at: Date
}

export const toChange = (row: ChangeRow): ProposedChange =>
  new ProposedChange({
    id: ChangeId.make(row.id),
    status: row.status,
    kind: row.kind,
    sku: row.sku,
    before: row.before,
    after: row.after,
    instruction: row.instruction,
    createdAt: row.created_at.toISOString()
  })

export const loadChanges = (sql: SqlClient.SqlClient, orgId: OrgId, ids: ReadonlyArray<string>) =>
  ids.length === 0
    ? Effect.succeed([])
    : Effect.map(
      sql<ChangeRow>`
        select id, status, kind, sku, before, after, instruction, created_at from change_proposals
         where organization_id = ${orgId} and id in ${sql.in(ids)}
         order by created_at desc
      `,
      (rows) => rows.map(toChange)
    )
