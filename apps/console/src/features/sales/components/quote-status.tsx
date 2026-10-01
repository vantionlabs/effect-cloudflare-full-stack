/** A quote's status as a pill. The text is the raw status, which is what a test reads. */
import { StatusPill, type StatusTone } from "@/components/data/status-pill"
import type { QuoteStatus as Status } from "@ea/modules/sales/domain/Quote"

const TONES: Record<Status, StatusTone> = {
  draft: "orange",
  approved: "accent",
  sent: "accent",
  accepted: "green",
  declined: "red",
  discarded: "neutral"
}

export function QuoteStatus(props: { readonly status: Status }) {
  return <StatusPill tone={TONES[props.status]} testId="quote-status">{props.status}</StatusPill>
}
