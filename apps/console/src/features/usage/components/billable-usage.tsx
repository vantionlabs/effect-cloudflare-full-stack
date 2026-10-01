/**
 * What the organization is charged for. `data-meter` sits on the element holding the number, because the e2e reads
 * the RAW server HTML for it — the proof that the page arrives with its figures rather than fetching them.
 */
import { Stat } from "@/components/data/stat"
import { formatCount } from "@/lib/format"

export function BillableUsage(props: { readonly documents: number; readonly decisions: number }) {
  return (
    <section aria-label="Billable usage" className="grid grid-cols-2 gap-3">
      <Stat
        label="Documents ingested"
        value={formatCount(props.documents)}
        valueAttributes={{ "data-meter": "documents.ingested" }}
      />
      <Stat
        label="Decisions completed"
        value={formatCount(props.decisions)}
        valueAttributes={{ "data-meter": "decisions.completed" }}
      />
    </section>
  )
}
