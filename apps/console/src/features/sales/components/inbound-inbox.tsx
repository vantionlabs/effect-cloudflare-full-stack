/**
 * The emails sent to the organization's quote-request address — read into drafts, or refused, and why.
 *
 * Every message that reached the address is here, refused ones included: a customer's request that vanished without
 * a trace is the failure this list exists to prevent. Drafting happens in the background (a queue), so a message can
 * sit at "ontvangen" for a few seconds; "Vernieuwen" re-reads the list rather than polling it.
 */
import { Button } from "@/components/atoms/Button"
import { EntityChip } from "@/components/atoms/EntityChip"
import { type Column, DataTable } from "@/components/data/data-table"
import { StatusPill, type StatusTone } from "@/components/data/status-pill"
import { Notice } from "@/components/feedback/notice"
import { SkeletonTable } from "@/components/feedback/skeleton"
import { inboundMessagesAtom, quotesAtom } from "@/features/sales/api/sales-atoms"
import { useHydrated } from "@/hooks/use-hydrated"
import { formatMoment } from "@/lib/format"
import { superseded } from "@/lib/motion"
import type { InboundMessage, InboundStatus } from "@ea/modules/sales/domain/Inbound"
import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import { Link } from "@tanstack/react-router"
import { RefreshCw } from "lucide-react"

const STATUS: Record<InboundStatus, { readonly label: string; readonly tone: StatusTone }> = {
  received: { label: "ontvangen", tone: "accent" },
  drafted: { label: "concept gemaakt", tone: "green" },
  failed: { label: "mislukt", tone: "red" },
  rejected: { label: "geweigerd", tone: "neutral" }
}

const columns: ReadonlyArray<Column<InboundMessage>> = [
  {
    key: "from",
    header: "Van",
    cell: (message) => (
      <span title={message.fromAddress}>
        <EntityChip name={message.fromName ?? message.fromAddress} className="mx-0" />
      </span>
    )
  },
  {
    key: "subject",
    header: "Onderwerp",
    cell: (message) => (
      <span className="block max-w-72 truncate text-ink-2" title={message.subject ?? undefined}>
        {message.subject ?? "(geen onderwerp)"}
      </span>
    )
  },
  {
    key: "received",
    header: "Ontvangen",
    priority: "secondary",
    sortBy: (message) => message.receivedAt,
    cell: (message) => <span className="whitespace-nowrap text-ink-2">{formatMoment(message.receivedAt)}</span>
  },
  {
    key: "status",
    header: "Status",
    cell: (message) => (
      <span className="flex flex-col items-start gap-0.5">
        <StatusPill tone={STATUS[message.status].tone} testId="inbound-status">
          {STATUS[message.status].label}
        </StatusPill>
        {message.reason === null ? null : <span className="text-[11px] text-ink-3">{message.reason}</span>}
      </span>
    )
  },
  {
    key: "draft",
    header: <span className="sr-only">Concept</span>,
    align: "right",
    cell: (message) =>
      message.quoteId === null ?
        null :
        (
          <a href={`#quote-${message.quoteId}`} className="text-[12px] text-accent-ink hover:underline">
            Naar concept
          </a>
        )
  }
]

export function InboundInbox() {
  const hydrated = useHydrated()
  const messages = useAtomValue(inboundMessagesAtom)
  const refreshMessages = useAtomRefresh(inboundMessagesAtom)
  const refreshQuotes = useAtomRefresh(quotesAtom)

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button
          variant="secondary"
          size="sm"
          disabled={!hydrated}
          onClick={() => {
            refreshMessages()
            refreshQuotes()
          }}
        >
          <RefreshCw className="size-3.5" aria-hidden />
          Vernieuwen
        </Button>
      </div>
      {messages._tag === "Initial"
        ? <SkeletonTable rows={2} columns={4} label="E-mails worden geladen" />
        : messages._tag === "Failure"
        ? <Notice tone="error">De binnengekomen e-mails konden niet worden geladen.</Notice>
        : (
          <div style={superseded(messages.waiting)} aria-busy={messages.waiting}>
            <DataTable
              caption="Binnengekomen e-mails"
              rows={messages.value}
              columns={columns}
              rowKey={(message) => message.id}
              rowTestId="inbound-message"
              empty={
                <span>
                  Nog geen e-mails. Maak in{" "}
                  <Link to="/settings" hash="offerte-email" className="text-accent-ink hover:underline">
                    Instellingen
                  </Link>{" "}
                  een adres voor offerteaanvragen; wat klanten daarheen sturen, verschijnt hier en wordt een concept.
                </span>
              }
            />
          </div>
        )}
    </div>
  )
}
