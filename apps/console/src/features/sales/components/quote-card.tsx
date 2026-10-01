/**
 * One quote and the actions its status allows. The buttons ARE the state machine as a person sees it: a draft has
 * no "Send to customer" — the only way forward is a person's approval — and only a sent quote can be answered.
 */
import { Button } from "@/components/atoms/Button"
import { Notice } from "@/components/feedback/notice"
import {
  approveQuoteAtom,
  discardQuoteAtom,
  QUOTES_KEY,
  respondToQuoteAtom,
  sendQuoteAtom
} from "@/features/sales/api/sales-atoms"
import { useHydrated } from "@/hooks/use-hydrated"
import { describeFailure } from "@/lib/failure"
import { formatMoment } from "@/lib/format"
import type { Quote } from "@ea/modules/sales/domain/Quote"
import { useAtomSet } from "@effect/atom-react"
import { Exit } from "effect"
import { useState } from "react"
import { SALES_FAILURES } from "../sales-failures.ts"
import { QuoteLines } from "./quote-lines.tsx"
import { QuoteStatus } from "./quote-status.tsx"

export function QuoteCard(props: { readonly quote: Quote; readonly onFailure: (message: string) => void }) {
  const { quote } = props
  const hydrated = useHydrated()
  const approve = useAtomSet(approveQuoteAtom, { mode: "promiseExit" })
  const discard = useAtomSet(discardQuoteAtom, { mode: "promiseExit" })
  const send = useAtomSet(sendQuoteAtom, { mode: "promiseExit" })
  const respond = useAtomSet(respondToQuoteAtom, { mode: "promiseExit" })
  const [busy, setBusy] = useState(false)

  const run = async (action: () => Promise<Exit.Exit<unknown, unknown>>) => {
    setBusy(true)
    const exit = await action()
    if (Exit.isFailure(exit)) props.onFailure(describeFailure(exit, SALES_FAILURES))
    setBusy(false)
  }
  const byId = { payload: { quoteId: quote.id }, reactivityKeys: [QUOTES_KEY] }
  const disabled = !hydrated || busy

  return (
    <article data-testid="quote" className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-card">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <h3 className="text-sm font-semibold text-ink">{quote.customerName ?? "Unknown customer"}</h3>
          <span className="text-[12px] text-ink-2">{quote.customerEmail ?? "no email"}</span>
        </div>
        <QuoteStatus status={quote.status} />
      </header>

      {quote.flags.length === 0 ? null : (
        <Notice>
          <ul className="list-disc pl-4" aria-label="Needs checking">
            {quote.flags.map((flag) => <li key={flag}>{flag}</li>)}
          </ul>
        </Notice>
      )}

      <QuoteLines quote={quote} />

      <footer className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
        {quote.status === "draft"
          ? (
            <Button variant="primary" size="sm" disabled={disabled} onClick={() => void run(() => approve(byId))}>
              Approve
            </Button>
          )
          : null}
        {quote.status === "approved"
          ? (
            <Button variant="primary" size="sm" disabled={disabled} onClick={() => void run(() => send(byId))}>
              Send to customer
            </Button>
          )
          : null}
        {quote.status === "sent"
          ? (
            <>
              <Button
                variant="success"
                size="sm"
                disabled={disabled}
                onClick={() =>
                  void run(() =>
                    respond({
                      payload: { quoteId: quote.id, accepted: true },
                      reactivityKeys: [QUOTES_KEY, "planning", "jobs"]
                    })
                  )}
              >
                Customer accepted
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={disabled}
                onClick={() =>
                  void run(() =>
                    respond({
                      payload: { quoteId: quote.id, accepted: false },
                      reactivityKeys: [QUOTES_KEY, "planning"]
                    })
                  )}
              >
                Declined
              </Button>
            </>
          )
          : null}
        {quote.status === "draft" || quote.status === "approved"
          ? (
            <Button variant="quiet" size="sm" disabled={disabled} onClick={() => void run(() => discard(byId))}>
              Discard
            </Button>
          )
          : null}
        {quote.sentAt === null ?
          null :
          <span className="ml-auto text-[12px] text-ink-3">Sent {formatMoment(quote.sentAt)}</span>}
      </footer>
    </article>
  )
}
