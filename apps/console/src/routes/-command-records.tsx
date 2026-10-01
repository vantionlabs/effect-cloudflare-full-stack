/**
 * The records the ⌘K palette searches: quotes, products and documentation.
 *
 * Here, in the routes folder (TanStack ignores files starting with `-`), because composing several features is a
 * route's job — `components/` may not import a feature, and one feature may not import another. Called only while the
 * palette is open, through the shell's `useCommandRecords` prop, so it reads the SAME atoms the pages use: whatever
 * Sales has already loaded is shown at once, and a page refetch refreshes the palette too.
 */
import type { CommandItem, CommandRecords } from "@/components/command/command-palette"
import { knowledgeDocumentsAtom } from "@/features/ask/api/knowledge-atoms"
import { productsAtom, quotesAtom } from "@/features/sales/api/sales-atoms"
import { QUOTE_STATUS_LABEL } from "@/features/sales/components/quote-status"
import { formatDay, formatEuro } from "@/lib/format"
import { useAtomValue } from "@effect/atom-react"
import { FileText, Package, ReceiptText } from "lucide-react"

export const useCommandRecords = (): CommandRecords => {
  const quotes = useAtomValue(quotesAtom)
  const products = useAtomValue(productsAtom)
  const documents = useAtomValue(knowledgeDocumentsAtom)

  const items: Array<CommandItem> = []
  if (quotes._tag === "Success") {
    for (const quote of quotes.value) {
      items.push({
        id: `quote:${quote.id}`,
        label: quote.customerName ?? quote.customerEmail ?? "Offerte zonder klantnaam",
        detail: `${QUOTE_STATUS_LABEL[quote.status]} · ${formatEuro(quote.total)}`,
        keywords: `${quote.customerEmail ?? ""} ${quote.request.slice(0, 200)}`,
        group: "Offertes",
        href: "/sales#quotes-heading",
        icon: <ReceiptText className="size-3.5" aria-hidden />
      })
    }
  }
  if (products._tag === "Success") {
    for (const product of products.value) {
      items.push({
        id: `product:${product.id}`,
        label: `${product.sku} · ${product.name}`,
        detail: product.active ? formatEuro(product.unitPrice) : "niet meer aangeboden",
        group: "Producten",
        href: "/sales#price-list-heading",
        icon: <Package className="size-3.5" aria-hidden />
      })
    }
  }
  if (documents._tag === "Success") {
    for (const document of documents.value) {
      items.push({
        id: `document:${document.documentId}`,
        label: document.filename,
        detail: formatDay(document.receivedAt),
        group: "Documentatie",
        href: "/ask",
        icon: <FileText className="size-3.5" aria-hidden />
      })
    }
  }
  return {
    loading: quotes._tag === "Initial" || products._tag === "Initial" || documents._tag === "Initial",
    items
  }
}
