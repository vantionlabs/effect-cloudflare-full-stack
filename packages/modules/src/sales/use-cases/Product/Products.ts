/**
 * The price list: list it, and add or change a product. Changing a product never touches quotes already drafted —
 * their lines carry their own copy of the price (see `SalesTable.ts`).
 */
import { Db } from "@ea/database/Database"
import { Ids } from "@ea/domain/Ids"
import { InvalidProduct } from "@ea/modules/sales/domain/Errors"
import { Product, ProductId, type Unit, VAT_RATES } from "@ea/modules/sales/domain/Product"
import { Cents, PerMille } from "@ea/modules/shared/domain/Money"
import { Effect } from "effect"

interface ProductRow {
  id: string
  sku: string
  name: string
  unit: Unit
  unit_price_cents: number
  vat_per_mille: number
  active: boolean
}

export const toProduct = (row: ProductRow): Product =>
  new Product({
    id: ProductId.make(row.id),
    sku: row.sku,
    name: row.name,
    unit: row.unit,
    unitPrice: Cents.make(row.unit_price_cents),
    vat: PerMille.make(row.vat_per_mille),
    active: row.active
  })

export const ListProducts = (options: { readonly includeInactive?: boolean | undefined } = {}) =>
  Effect.flatMap(Db, (db) =>
    db.scoped((sql, orgId) =>
      Effect.map(
        sql<ProductRow>`
          select id, sku, name, unit, unit_price_cents, vat_per_mille, active from products
           where organization_id = ${orgId}
             and (${options.includeInactive === true} or active)
           order by sku
        `,
        (rows) => rows.map(toProduct)
      )
    ))

export interface UpsertProductInput {
  readonly sku: string
  readonly name: string
  readonly unit: Unit
  readonly unitPrice: number
  readonly vat: number
  readonly active: boolean
}

/** Adds a product, or updates the one with the same SKU. Refuses a VAT rate or price the column would refuse. */
export const UpsertProduct = (input: UpsertProductInput) =>
  Effect.gen(function*() {
    const sku = input.sku.trim()
    const name = input.name.trim()
    if (sku === "" || name === "") return yield* new InvalidProduct({ reason: "A product needs a SKU and a name." })
    if (!Number.isInteger(input.unitPrice) || input.unitPrice < 0) {
      return yield* new InvalidProduct({ reason: "The price must be a whole number of cents, not negative." })
    }
    if (!VAT_RATES.includes(input.vat)) {
      return yield* new InvalidProduct({ reason: `VAT must be one of ${VAT_RATES.join(", ")} per mille.` })
    }
    const db = yield* Db
    const ids = yield* Ids
    const id = yield* ids.next
    return yield* db.scoped((sql, orgId) =>
      Effect.map(
        sql<ProductRow>`
          insert into products (id, organization_id, sku, name, unit, unit_price_cents, vat_per_mille, active)
          values (${id}, ${orgId}, ${sku}, ${name}, ${input.unit}, ${input.unitPrice}, ${input.vat}, ${input.active})
          on conflict (organization_id, sku) do update
            set name = excluded.name, unit = excluded.unit, unit_price_cents = excluded.unit_price_cents,
                vat_per_mille = excluded.vat_per_mille, active = excluded.active, updated_at = now()
          returning id, sku, name, unit, unit_price_cents, vat_per_mille, active
        `,
        (rows) => toProduct(rows[0]!)
      )
    )
  })
