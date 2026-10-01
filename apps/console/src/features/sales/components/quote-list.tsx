/**
 * Every quote, newest first, filterable by status. Each card carries the actions its status allows.
 *
 * Quotes drafted after the page was shown slide in; the ones the server rendered are simply there. While the list is
 * being refreshed after an action, the current cards stay readable but dimmed — they ARE about to be replaced.
 */
import { Notice } from "@/components/feedback/notice"
import { SkeletonText } from "@/components/feedback/skeleton"
import FilterTable from "@/components/primitives/FilterTable"
import { quotesAtom } from "@/features/sales/api/sales-atoms"
import { useArrivals } from "@/hooks/use-arrivals"
import { enter, superseded } from "@/lib/motion"
import type { QuoteStatus as Status } from "@ea/modules/sales/domain/Quote"
import { useAtomValue } from "@effect/atom-react"
import { QuoteCard } from "./quote-card.tsx"

const FILTERS: ReadonlyArray<{ readonly key: Status; readonly label: string; readonly dot: string }> = [
  { key: "draft", label: "Concept", dot: "var(--orange)" },
  { key: "approved", label: "Goedgekeurd", dot: "var(--accent)" },
  { key: "sent", label: "Verstuurd", dot: "var(--accent)" },
  { key: "accepted", label: "Geaccepteerd", dot: "var(--green)" },
  { key: "declined", label: "Afgewezen", dot: "var(--red)" },
  { key: "discarded", label: "Vervallen", dot: "var(--ink-3)" }
]

export function QuoteList(props: { readonly onFailure: (message: string) => void }) {
  const quotes = useAtomValue(quotesAtom)
  const arrived = useArrivals(quotes._tag === "Success" ? quotes.value : [], (quote) => quote.id)

  if (quotes._tag === "Initial") return <SkeletonText lines={4} label="Offertes worden geladen" />
  if (quotes._tag === "Failure") return <Notice tone="error">De offertes konden niet worden geladen.</Notice>
  if (quotes.value.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-line-strong px-4 py-6 text-center text-[13px] text-ink-2">
        Nog geen offertes. Plak hierboven een klantvraag; je keurt elke offerte goed voordat er iets naar de klant gaat.
      </p>
    )
  }
  return (
    <FilterTable
      rows={quotes.value}
      statusOf={(quote) => quote.status}
      filters={FILTERS}
      allLabel="Alle"
      label="Offertes filteren op status"
    >
      {(shown) =>
        shown.length === 0
          ? <p className="px-1 py-3 text-[13px] text-ink-2">Geen offertes met deze status.</p>
          : (
            <div className="flex flex-col gap-3" style={superseded(quotes.waiting)} aria-busy={quotes.waiting}>
              {shown.map((quote) => (
                <div key={quote.id} style={arrived.has(quote.id) ? enter(arrived.get(quote.id)) : undefined}>
                  <QuoteCard quote={quote} onFailure={props.onFailure} />
                </div>
              ))}
            </div>
          )}
    </FilterTable>
  )
}
