/**
 * A quote's status as a pill, in the words office staff use. The raw status value stays in the data; only the label
 * a person reads is Dutch.
 */
import { StatusPill, type StatusTone } from "@/components/data/status-pill"
import type { QuoteStatus as Status } from "@ea/modules/sales/domain/Quote"

export const QUOTE_STATUS_LABEL: Record<Status, string> = {
  draft: "concept",
  approved: "goedgekeurd",
  sent: "verstuurd",
  accepted: "geaccepteerd",
  declined: "afgewezen",
  discarded: "vervallen"
}

const QUOTE_STATUS_TONE: Record<Status, StatusTone> = {
  draft: "orange",
  approved: "accent",
  sent: "accent",
  accepted: "green",
  declined: "red",
  discarded: "neutral"
}

export function QuoteStatus(props: { readonly status: Status }) {
  return (
    <StatusPill tone={QUOTE_STATUS_TONE[props.status]} testId="quote-status">
      {QUOTE_STATUS_LABEL[props.status]}
    </StatusPill>
  )
}
