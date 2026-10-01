/**
 * One quote and the actions its status allows. The buttons ARE the state machine as a person sees it: a concept has
 * no "Naar klant sturen" — the only way forward is a person's approval — and only a sent quote can be answered.
 *
 * The lines are open while the quote still needs a person's check (concept, goedgekeurd) and folded away after it was
 * sent, so a long list of answered quotes stays scannable. The total is always visible.
 */
import { Button } from "@/components/atoms/Button"
import { EntityChip } from "@/components/atoms/EntityChip"
import { Shimmer } from "@/components/atoms/Shimmer"
import { Notice } from "@/components/feedback/notice"
import { Collapsible } from "@/components/motion/collapsible"
import {
  approveQuoteAtom,
  discardQuoteAtom,
  QUOTES_KEY,
  respondToQuoteAtom,
  sendQuoteAtom
} from "@/features/sales/api/sales-atoms"
import { useHydrated } from "@/hooks/use-hydrated"
import { describeFailure } from "@/lib/failure"
import { formatEuro, formatMoment, plural } from "@/lib/format"
import type { Quote } from "@ea/modules/sales/domain/Quote"
import { useAtomSet } from "@effect/atom-react"
import { Exit } from "effect"
import { ChevronDown } from "lucide-react"
import { useId, useState } from "react"
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
  const [busy, setBusy] = useState<string | null>(null)
  const needsCheck = quote.status === "draft" || quote.status === "approved"
  const [open, setOpen] = useState(needsCheck)
  const linesId = useId()

  const run = async (label: string, action: () => Promise<Exit.Exit<unknown, unknown>>) => {
    setBusy(label)
    const exit = await action()
    if (Exit.isFailure(exit)) props.onFailure(describeFailure(exit, SALES_FAILURES))
    setBusy(null)
  }
  const byId = { payload: { quoteId: quote.id }, reactivityKeys: [QUOTES_KEY] }
  const disabled = !hydrated || busy !== null
  const label = (name: string, text: string) => busy === name ? <Shimmer>{text}…</Shimmer> : text

  return (
    <article data-testid="quote" className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-card">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-sm font-semibold text-ink">
            <span className="sr-only">Offerte voor</span>
            <EntityChip name={quote.customerName ?? "Onbekende klant"} className="mx-0 text-[13px]" />
          </h3>
          <span className="truncate text-[12px] text-ink-2">{quote.customerEmail ?? "geen e-mailadres"}</span>
        </div>
        <QuoteStatus status={quote.status} />
      </header>

      {quote.flags.length === 0 ? null : (
        <Notice>
          <span className="font-medium text-ink">Controleer dit eerst</span>
          <ul className="mt-1 list-disc pl-4" aria-label="Te controleren">
            {quote.flags.map((flag) => <li key={flag}>{flag}</li>)}
          </ul>
        </Notice>
      )}

      {quote.lines.length === 0 ? null : (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={linesId}
            onClick={() => setOpen(!open)}
            className="flex w-fit items-center gap-1 rounded-control px-1 py-0.5 text-[12px] font-medium text-ink-2 transition-colors duration-100 hover:bg-hover hover:text-ink"
          >
            <ChevronDown
              aria-hidden
              className="size-3.5 transition-transform duration-200"
              style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
            />
            {plural(quote.lines.length, "regel", "regels")}
          </button>
          <Collapsible open={open} id={linesId}>
            <QuoteLines quote={quote} />
          </Collapsible>
        </div>
      )}

      <dl className="tabular ml-auto grid grid-cols-[auto_auto] gap-x-4 text-right text-[13px]">
        <dt className="text-ink-2">Subtotaal</dt>
        <dd className="text-ink">{formatEuro(quote.subtotal)}</dd>
        <dt className="text-ink-2">Btw</dt>
        <dd className="text-ink">{formatEuro(quote.vatTotal)}</dd>
      </dl>
      <div className="tabular text-right text-sm font-semibold text-ink" data-testid="quote-total">
        Totaal {formatEuro(quote.total)}
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
        {quote.status === "draft"
          ? (
            <Button
              variant="primary"
              size="sm"
              disabled={disabled}
              onClick={() => void run("approve", () => approve(byId))}
            >
              {label("approve", "Goedkeuren")}
            </Button>
          )
          : null}
        {quote.status === "approved"
          ? (
            <Button variant="primary" size="sm" disabled={disabled} onClick={() => void run("send", () => send(byId))}>
              {label("send", "Naar klant sturen")}
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
                  void run("accept", () =>
                    respond({
                      payload: { quoteId: quote.id, accepted: true },
                      reactivityKeys: [QUOTES_KEY, "planning", "jobs"]
                    }))}
              >
                {label("accept", "Klant akkoord")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={disabled}
                onClick={() =>
                  void run("decline", () =>
                    respond({
                      payload: { quoteId: quote.id, accepted: false },
                      reactivityKeys: [QUOTES_KEY, "planning"]
                    }))}
              >
                {label("decline", "Klant wijst af")}
              </Button>
            </>
          )
          : null}
        {needsCheck
          ? (
            <Button
              variant="quiet"
              size="sm"
              disabled={disabled}
              onClick={() => void run("discard", () => discard(byId))}
            >
              {label("discard", "Weggooien")}
            </Button>
          )
          : null}
        {quote.sentAt === null ?
          null :
          <span className="ml-auto text-[12px] text-ink-3">Verstuurd {formatMoment(quote.sentAt)}</span>}
      </footer>
    </article>
  )
}
