/**
 * The decision under inspection: what was decided, why it is not automatic, and every citation checked against
 * its clause — then the reviewers' notes beside the machine's reasoning.
 *
 * The rails and each cited clause open and close (`Collapsible`, Beautiful UI's grid-row drawer) so a reviewer can
 * fold away what they have checked. Both start OPEN: they are the reasons this decision is on the screen, and a
 * reviewer must never have to discover them.
 */
import { StatusPill } from "@/components/data/status-pill"
import { Notice } from "@/components/feedback/notice"
import { Skeleton, SkeletonText } from "@/components/feedback/skeleton"
import { Thread } from "@/components/thread/thread"
import { enter } from "@/lib/motion"
import { useAtomValue } from "@effect/atom-react"
import { decisionAtom } from "../api/queue-atoms.ts"
import { CitedClause } from "./cited-clause.tsx"
import { Disclosure } from "./disclosure.tsx"
import { outcomeLabel, retrievalLabel } from "./outcome-label.ts"

export function DecisionInspector({ decisionId }: { readonly decisionId: string }) {
  // One atom per id, from module scope — see `decisionAtom` for why this must not be built during render.
  const detail = useAtomValue(decisionAtom(decisionId))

  if (detail._tag === "Failure") {
    return (
      <section className="p-8">
        <Notice tone="error">
          Deze beslissing kon niet worden geladen. Kies hem opnieuw om het nog eens te proberen.
        </Notice>
      </section>
    )
  }
  if (detail._tag !== "Success" || detail.value === null) return <InspectorSkeleton />
  const decision = detail.value

  return (
    <section
      key={decisionId}
      className="flex min-h-0 flex-col gap-6 overflow-y-auto p-6 md:p-8"
      style={enter(0, { ms: 300 })}
    >
      <header className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-ink">{decision.filename}</h2>
        <p className="flex flex-wrap items-center gap-1 text-[13px] text-ink-2">
          {outcomeLabel(decision.outcome)} · {retrievalLabel(decision.retrievalMode)} · {decision.model}
          {decision.grounded ? null : <StatusPill tone="red">niet onderbouwd</StatusPill>}
        </p>
      </header>

      {decision.railsFired.length === 0 ?
        null :
        (
          <Disclosure
            title="Waarom dit niet automatisch is"
            count={decision.railsFired.length}
            className="rounded-card bg-orange-tint p-4 text-[13px] text-ink"
            titleClassName="font-semibold text-orange"
          >
            <ul className="list-disc pt-2 pl-5">
              {decision.railsFired.map((rail) => <li key={rail}>{rail}</li>)}
            </ul>
          </Disclosure>
        )}

      <p className="max-w-[70ch] text-sm whitespace-pre-wrap text-ink">{decision.rationale}</p>

      <div className="flex flex-col gap-3">
        <h3 className="text-[13px] font-semibold text-ink">Bronnen</h3>
        {decision.citations.length === 0
          ? <Notice tone="error">Geen bronnen — er is niets om tegen te controleren.</Notice>
          : decision.citations.map((cited, index) => (
            <CitedClause
              key={index}
              reference={cited.citation.clause_ref ?? cited.citation.chunk_id}
              clauseText={cited.clauseText}
              excerpt={cited.citation.excerpt}
            />
          ))}
      </div>

      {/* The humans' reasoning, next to the machine's. See thread.tsx. */}
      <Thread kind="decision" id={decisionId} title="Notities" />

      <footer className="text-[12px] text-ink-3">
        <kbd className="rounded-chip bg-inset px-1 font-mono shadow-hairline">
          j
        </kbd>/<kbd className="rounded-chip bg-inset px-1 font-mono shadow-hairline">k</kbd> verplaatsen ·{" "}
        <kbd className="rounded-chip bg-inset px-1 font-mono shadow-hairline">a</kbd> goedkeuren ·{" "}
        <kbd className="rounded-chip bg-inset px-1 font-mono shadow-hairline">r</kbd> afwijzen
      </footer>
    </section>
  )
}

/** The inspector's shape while a decision loads in the browser. */
export function InspectorSkeleton() {
  return (
    <section role="status" aria-label="Beslissing laden" className="flex flex-col gap-6 p-6 md:p-8">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-3.5 w-48" />
      </div>
      <SkeletonText lines={3} label="Toelichting laden" />
      <div className="flex flex-col gap-2 rounded-card bg-surface p-4 shadow-card">
        <Skeleton className="h-3 w-24" />
        <SkeletonText lines={2} label="Bron laden" />
      </div>
    </section>
  )
}
