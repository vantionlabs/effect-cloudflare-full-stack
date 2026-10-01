/**
 * The decision under inspection: what was decided, why it is not automatic, and every citation checked against
 * its clause — then the reviewers' notes beside the machine's reasoning.
 */
import { StatusPill } from "@/components/data/status-pill"
import { Notice } from "@/components/feedback/notice"
import { Thread } from "@/components/thread/thread"
import { useAtomValue } from "@effect/atom-react"
import { decisionAtom } from "../api/queue-atoms.ts"
import { CitedClause } from "./cited-clause.tsx"

export function DecisionInspector({ decisionId }: { readonly decisionId: string }) {
  // One atom per id, from module scope — see `decisionAtom` for why this must not be built during render.
  const detail = useAtomValue(decisionAtom(decisionId))

  if (detail._tag !== "Success" || detail.value === null) {
    return <section className="p-8 text-[13px] text-ink-2">loading…</section>
  }
  const decision = detail.value

  return (
    <section className="flex min-h-0 flex-col gap-6 overflow-y-auto p-6 md:p-8">
      <header className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-ink">{decision.filename}</h2>
        <p className="flex flex-wrap items-center gap-1 text-[13px] text-ink-2">
          {decision.outcome} · {decision.retrievalMode} retrieval · {decision.model}
          {decision.grounded ? null : <StatusPill tone="red">ungrounded</StatusPill>}
        </p>
      </header>

      {decision.railsFired.length === 0 ?
        null :
        (
          <div className="flex flex-col gap-2 rounded-card bg-orange-tint p-4 text-[13px] text-ink">
            <strong className="font-semibold text-orange">why this is not automatic</strong>
            <ul className="list-disc pl-5">
              {decision.railsFired.map((rail) => <li key={rail}>{rail}</li>)}
            </ul>
          </div>
        )}

      <p className="text-sm whitespace-pre-wrap text-ink">{decision.rationale}</p>

      <div className="flex flex-col gap-3">
        <h3 className="text-[12px] font-semibold tracking-wide text-ink-2 uppercase">Citations</h3>
        {decision.citations.length === 0
          ? <Notice tone="error">none — nothing to check against</Notice>
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
      <Thread kind="decision" id={decisionId} title="NOTES" />

      <footer className="text-[12px] text-ink-3">
        <kbd className="rounded-chip bg-inset px-1 font-mono shadow-hairline">
          j
        </kbd>/<kbd className="rounded-chip bg-inset px-1 font-mono shadow-hairline">k</kbd> move ·{" "}
        <kbd className="rounded-chip bg-inset px-1 font-mono shadow-hairline">a</kbd> approve ·{" "}
        <kbd className="rounded-chip bg-inset px-1 font-mono shadow-hairline">r</kbd> reject
      </footer>
    </section>
  )
}
