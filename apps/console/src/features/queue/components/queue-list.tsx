/**
 * The review queue, oldest first: one row per pending decision, with why it needs a person visible in the row.
 *
 * Motion, each for a reason (lib/motion, Beautiful UI): one hover layer GLIDES between rows instead of each row
 * painting its own; the count ROLLS when a realtime event changes it; and a row that ARRIVES while the page is open
 * enters with `fade-up` — rows the page was rendered with do not, because nothing about them is new.
 */
import { StatusPill } from "@/components/data/status-pill"
import { Skeleton } from "@/components/feedback/skeleton"
import { RollingDigits } from "@/components/motion/rolling-digits"
import GlideMenu from "@/components/primitives/GlideMenu"
import { useArrivals } from "@/hooks/use-arrivals"
import { enter } from "@/lib/motion"
import { cn } from "@/lib/utils"
import type { Viewer } from "@ea/realtime/Presence"
import { outcomeLabel, retrievalLabel } from "./outcome-label.ts"

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
  const arrived = useArrivals(items, (item) => item.decisionId)
  return (
    <nav aria-label="Te beoordelen" className="flex min-h-0 flex-col border-line bg-surface md:border-r">
      <header className="flex flex-wrap items-baseline gap-x-2 border-b border-line px-4 py-3">
        <h1 className="text-[15px] font-semibold text-ink">Te beoordelen</h1>
        <span className="text-[12px] text-ink-2" data-testid="queue-count">
          <RollingDigits value={String(items.length)} /> · oudste eerst
        </span>
        {
          /*
           * Who else is here, and on what.
           *
           * The point is the one failure this does not otherwise prevent: two reviewers opening the same
           * invoice, one approving it, and the other discovering that from a lost CAS race. Seeing a
           * colleague on a row is the cheap half of that — the CAS is still what makes it safe.
           *
           * Absent entirely when nobody else is connected, rather than rendering "0 anderen": an empty
           * indicator is noise on the screen of the person working alone, which is most of the time.
           */
        }
        {others.length === 0 ?
          null :
          (
            <span className="text-[12px] text-ink-3" title={others.map((viewer) => viewer.email).join(", ")}>
              · {others.length === 1 ? "1 collega" : `${others.length} collega's`} kijkt mee
            </span>
          )}
      </header>
      <GlideMenu className="min-h-0 flex-1 overflow-y-auto" highlightClassName="inset-x-1.5 rounded-control bg-hover">
        <ol>
          {items.map((item, index) => {
            const slot = arrived.get(item.decisionId)
            const style = slot === undefined ? undefined : enter(slot)
            const current = index === selected
            return (
              <li key={item.decisionId} style={style}>
                <button
                  type="button"
                  data-menu-row
                  onClick={() => onSelect(index)}
                  aria-current={current ? "true" : undefined}
                  className={cn(
                    "relative z-10 flex w-full flex-col gap-1 border-b border-line-soft px-4 py-3 text-left",
                    "transition-transform duration-150 active:scale-[0.99] focus-visible:outline-none",
                    current && "bg-accent-tint"
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
                    {outcomeLabel(item.outcome)}
                    {item.grounded ? null : <StatusPill tone="red">niet onderbouwd</StatusPill>}
                    {item.retrievalMode === "hybrid"
                      ? null
                      : <StatusPill tone="orange">{retrievalLabel(item.retrievalMode)}</StatusPill>}
                    {item.railsFired.length === 0
                      ? null
                      : (
                        <StatusPill tone="neutral">
                          {item.railsFired.length === 1 ? "1 controle" : `${item.railsFired.length} controles`}
                        </StatusPill>
                      )}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </GlideMenu>
    </nav>
  )
}

/** The list's shape while the queue loads in the browser (a refetch after an error, for instance). */
export function QueueListSkeleton() {
  return (
    <nav aria-label="Te beoordelen" className="flex min-h-0 flex-col border-line bg-surface md:border-r">
      <header className="border-b border-line px-4 py-3">
        <h1 className="text-[15px] font-semibold text-ink">Te beoordelen</h1>
      </header>
      <div role="status" aria-label="Wachtrij laden" className="flex flex-col">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="flex flex-col gap-2 border-b border-line-soft px-4 py-3.5">
            <Skeleton className="h-3.5 w-44" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>
    </nav>
  )
}
