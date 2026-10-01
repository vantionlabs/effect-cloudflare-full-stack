/**
 * What the organization is charged for. `data-meter` sits on the element holding the number, because the e2e reads
 * the RAW server HTML for it — the proof that the page arrives with its figures rather than fetching them.
 *
 * The figure is a `RollingDigits`: on first render it is simply the number; after a refresh that changed it, it rolls.
 */
import { Stat } from "@/components/data/stat"
import { RollingDigits } from "@/components/motion/rolling-digits"
import { formatCount } from "@/lib/format"

export function BillableUsage(props: { readonly documents: number; readonly decisions: number }) {
  return (
    <section aria-label="Gefactureerd verbruik" className="grid grid-cols-2 gap-3">
      <Stat
        label="Documenten verwerkt"
        value={<RollingDigits value={formatCount(props.documents)} />}
        detail="Elk binnengekomen document telt één keer."
        valueAttributes={{ "data-meter": "documents.ingested" }}
      />
      <Stat
        label="Beslissingen genomen"
        value={<RollingDigits value={formatCount(props.decisions)} />}
        detail="Automatisch of door een mens afgerond."
        valueAttributes={{ "data-meter": "decisions.completed" }}
      />
    </section>
  )
}
