/** The price list: the ONLY source of prices on a quote. Products no longer offered are shown, greyed. */
import { type Column, DataTable } from "@/components/data/data-table"
import { StatusPill } from "@/components/data/status-pill"
import { Notice } from "@/components/feedback/notice"
import { SkeletonTable } from "@/components/feedback/skeleton"
import { productsAtom } from "@/features/sales/api/sales-atoms"
import { formatEuro } from "@/lib/format"
import { superseded } from "@/lib/motion"
import type { Product } from "@ea/modules/sales/domain/Product"
import { useAtomValue } from "@effect/atom-react"
import { UNIT_LABEL } from "../units.ts"

const COLUMNS: ReadonlyArray<Column<Product>> = [
  {
    key: "sku",
    header: "Artikelnummer",
    cell: (product) => <span className="font-mono text-[12px]">{product.sku}</span>
  },
  {
    key: "name",
    header: "Product",
    cell: (product) => <span className={product.active ? "text-ink" : "text-ink-3"}>{product.name}</span>
  },
  {
    key: "unit",
    header: "Eenheid",
    cell: (product) => (
      <span className="text-ink-2">{UNIT_LABEL[product.unit as keyof typeof UNIT_LABEL] ?? product.unit}</span>
    )
  },
  {
    key: "price",
    header: "Prijs excl. btw",
    align: "right",
    cell: (product) => <span className="whitespace-nowrap">{formatEuro(product.unitPrice)}</span>
  },
  { key: "vat", header: "Btw", align: "right", cell: (product) => `${product.vat / 10}%` },
  {
    key: "active",
    header: <span className="sr-only">Status</span>,
    align: "right",
    cell: (product) => product.active ? null : <StatusPill tone="neutral">niet meer leverbaar</StatusPill>
  }
]

export function ProductTable() {
  const products = useAtomValue(productsAtom)
  if (products._tag === "Initial") return <SkeletonTable rows={3} columns={5} label="Prijslijst wordt geladen" />
  if (products._tag === "Failure") return <Notice tone="error">De prijslijst kon niet worden geladen.</Notice>
  return (
    <div style={superseded(products.waiting)} aria-busy={products.waiting}>
      <DataTable
        caption="Producten"
        rows={products.value}
        columns={COLUMNS}
        rowKey={(product) => product.id}
        empty="Nog geen producten. Voeg hieronder het eerste toe; offertes rekenen alleen met prijzen uit deze lijst."
      />
    </div>
  )
}
