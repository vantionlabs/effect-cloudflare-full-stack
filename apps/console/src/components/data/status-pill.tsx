/**
 * A record's state as a coloured pill. Tones carry meaning consistently across pages: green is done or paid, orange
 * needs someone, red is refused or overdue, accent is in flight, neutral is everything else.
 */
import { ValuePill } from "@/components/atoms/ValuePill"

export type StatusTone = "neutral" | "green" | "orange" | "red" | "accent"

export function StatusPill(props: { readonly tone: StatusTone; readonly children: string; readonly testId?: string }) {
  return (
    <span data-testid={props.testId} className="inline-flex">
      <ValuePill tone={props.tone} className="mx-0">{props.children}</ValuePill>
    </span>
  )
}
