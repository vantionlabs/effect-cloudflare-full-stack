/** Every quote, newest first, as cards — each with the actions its status allows. */
import { quotesAtom } from "@/features/sales/api/sales-atoms"
import { useAtomValue } from "@effect/atom-react"
import { QuoteCard } from "./quote-card.tsx"

export function QuoteList(props: { readonly onFailure: (message: string) => void }) {
  const quotes = useAtomValue(quotesAtom)
  if (quotes._tag !== "Success") {
    return (
      <p className="text-sm text-ink-2">
        {quotes._tag === "Failure" ? "Quotes could not be loaded." : "Loading quotes…"}
      </p>
    )
  }
  if (quotes.value.length === 0) return <p className="text-sm text-ink-2">No quotes yet.</p>
  return (
    <div className="flex flex-col gap-3">
      {quotes.value.map((quote) => <QuoteCard key={quote.id} quote={quote} onFailure={props.onFailure} />)}
    </div>
  )
}
