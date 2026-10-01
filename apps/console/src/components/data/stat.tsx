/** A headline figure — "Open facturen € 4.200,00, 3 facturen". */
import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

export function Stat(props: {
  readonly label: string
  readonly value: ReactNode
  readonly detail?: ReactNode
  readonly tone?: "default" | "warning"
  /** On the VALUE, which is what a test reads. */
  readonly testId?: string
  /** Extra attributes for the value element, e.g. `{ "data-meter": "documents" }` for a test reading raw HTML. */
  readonly valueAttributes?: Readonly<Record<`data-${string}`, string>>
}) {
  return (
    <div className="flex flex-col gap-1 rounded-card bg-surface p-4 shadow-card">
      <span className="text-[12px] font-medium text-ink-2">{props.label}</span>
      <span
        className={cn("tabular text-lg font-semibold", props.tone === "warning" ? "text-orange" : "text-ink")}
        data-testid={props.testId}
        {...props.valueAttributes}
      >
        {props.value}
      </span>
      {props.detail === undefined ? null : <span className="text-[12px] text-ink-3">{props.detail}</span>}
    </div>
  )
}
