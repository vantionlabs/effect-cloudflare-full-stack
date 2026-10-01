/** One lookup the model made, and exactly what it returned. */
import { Panel } from "@/components/layout/page"
import type { DataLookup } from "@ea/modules/reporting/domain/DataAsk"
import { DataValue } from "./data-value.tsx"

const TOOL_TITLES: Record<string, string> = {
  activity_figures: "Activity",
  quote_figures: "Quotes",
  list_quotes: "Recent quotes",
  planning_figures: "Cash planning"
}

export function DataLookupCard(props: { readonly lookup: DataLookup }) {
  return (
    <Panel>
      <div data-testid="data-lookup" className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-semibold text-ink">{TOOL_TITLES[props.lookup.tool] ?? props.lookup.tool}</h3>
          <code className="rounded-chip bg-field px-1.5 text-[11px] text-ink-3">{props.lookup.tool}</code>
        </div>
        <DataValue value={props.lookup.result} />
      </div>
    </Panel>
  )
}
