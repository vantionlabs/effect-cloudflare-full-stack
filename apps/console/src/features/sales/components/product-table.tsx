/** The price list: the ONLY source of prices on a quote. Inactive products are shown, greyed. */
import { type Column, DataTable } from "@/components/data/data-table"
import { StatusPill } from "@/components/data/status-pill"
import { productsAtom } from "@/features/sales/api/sales-atoms"
import { formatEuro } from "@/lib/format"
import type { Product } from "@ea/modules/sales/domain/Product"
import { useAtomValue } from "@effect/atom-react"

const COLUMNS: ReadonlyArray<Column<Product>> = [
  { key: "sku", header: "SKU", cell: (product) => <span className="font-mono text-[12px]">{product.sku}</span> },
  {
    key: "name",
    header: "Product",
    cell: (product) => <span className={product.active ? "text-ink" : "text-ink-3"}>{product.name}</span>
  },
  { key: "unit", header: "Unit", cell: (product) => <span className="text-ink-2">{product.unit}</span> },
  { key: "price", header: "Price", align: "right", cell: (product) => formatEuro(product.unitPrice) },
  { key: "vat", header: "VAT", align: "right", cell: (product) => `${product.vat / 10}%` },
  {
    key: "active",
    header: <span className="sr-only">Status</span>,
    align: "right",
    cell: (product) => product.active ? null : <StatusPill tone="neutral">inactive</StatusPill>
  }
]

export function ProductTable() {
  const products = useAtomValue(productsAtom)
  if (products._tag !== "Success") {
    return (
      <p className="text-sm text-ink-2">
        {products._tag === "Failure" ? "The price list could not be loaded." : "Loading the price list…"}
      </p>
    )
  }
  return (
    <DataTable
      caption="Products"
      rows={products.value}
      columns={COLUMNS}
      rowKey={(product) => product.id}
      empty="No products yet. Add the first one below."
    />
  )
}
