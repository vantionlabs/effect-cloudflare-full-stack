/**
 * The review queue, oldest first: one row per pending decision, with why it needs a person visible in the row.
 */
import { StatusPill } from "@/components/data/status-pill"
import { cn } from "@/lib/utils"
import type { Viewer } from "@ea/realtime/Presence"

export interface QueueItem {
  readonly decisionId: string
  readonly filename: string
  readonly outcome: string
  readonly railsFired: ReadonlyArray<string>
  readonly retrievalMode: string
  readonly grounded: boolean
}

export function QueueList({ items, onSelect, others, selected }: {
  /** Other people connected to this organization's room, and what they have open. */
  readonly others: ReadonlyArray<Viewer>
  readonly items: ReadonlyArray<QueueItem>
  readonly selected: number
  readonly onSelect: (index: number) => void
}) {
  return (
    <nav aria-label="Review queue" className="flex min-h-0 flex-col border-line bg-surface md:border-r">
      <header className="flex flex-wrap items-baseline gap-x-2 border-b border-line px-4 py-3">
        <h1 className="text-[15px] font-semibold text-ink">Review queue</h1>
        <span className="text-[12px] text-ink-2">{items.length} · oldest first</span>
        {
          /*
           * Who else is here, and on what.
           *
           * The point is the one failure this does not otherwise prevent: two reviewers opening the same
           * invoice, one approving it, and the other discovering that from a lost CAS race. Seeing a
           * colleague on a row is the cheap half of that — the CAS is still what makes it safe.
           *
           * Absent entirely when nobody else is connected, rather than rendering "0 others": an empty
           * indicator is noise on the screen of the person working alone, which is most of the time.
           */
        }
        {others.length === 0 ?
          null :
          (
            <span className="text-[12px] text-ink-3" title={others.map((viewer) => viewer.email).join(", ")}>
              · {others.length} other{others.length === 1 ? "" : "s"} here
            </span>
          )}
      </header>
      <ol className="min-h-0 flex-1 overflow-y-auto">
        {items.map((item, index) => (
          <li key={item.decisionId}>
            <button
              type="button"
              onClick={() => onSelect(index)}
              aria-current={index === selected ? "true" : undefined}
              className={cn(
                "flex w-full flex-col gap-1 border-b border-line-soft px-4 py-3 text-left transition-colors",
                "hover:bg-hover focus-visible:bg-hover focus-visible:outline-none",
                index === selected && "bg-accent-tint hover:bg-accent-tint"
              )}
            >
              <span className="truncate text-[13px] font-medium text-ink">{item.filename}</span>
              {
                /*
                 * Why it needs a human, in the list. A reviewer triaging forty items should not have to open each
                 * one to learn that retrieval was degraded, or that a span did not verify.
                 */
              }
              <span className="flex flex-wrap items-center gap-1 text-[12px] text-ink-2">
                {item.outcome}
                {item.grounded ? null : <StatusPill tone="red">ungrounded</StatusPill>}
                {item.retrievalMode === "hybrid"
                  ? null
                  : <StatusPill tone="orange">{`${item.retrievalMode} retrieval`}</StatusPill>}
                {item.railsFired.length === 0
                  ? null
                  : <StatusPill tone="neutral">{`${item.railsFired.length} rail(s)`}</StatusPill>}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}
