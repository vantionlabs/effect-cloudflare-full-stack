/**
 * The lookups the model made, in the order it made them, and exactly what each returned — as Beautiful UI's
 * `ToolChips` (rewired: real rows only, no reveal timer). Rows start open, because what they returned is the point:
 * the data is the authority, the answer is a convenience.
 */
import ToolChips, { type ToolStep } from "@/components/primitives/ToolChips"
import type { DataLookup } from "@ea/modules/reporting/domain/DataAsk"
import { Database } from "lucide-react"
import { DataValue } from "./data-value.tsx"

const TOOL_TITLES: Record<string, string> = {
  activity_figures: "Activiteit",
  quote_figures: "Offertes",
  list_quotes: "Recente offertes",
  planning_figures: "Kasplanning"
}

/** What the lookup was asked for, in a word: its period or horizon when it had one, else the tool's own name. */
const chipOf = (lookup: DataLookup): string => {
  const result = lookup.result as Record<string, unknown> | null
  const period = result !== null && typeof result === "object" ? result["period"] : undefined
  if (typeof period === "object" && period !== null) {
    const { from, to } = period as { readonly from?: unknown; readonly to?: unknown }
    if (typeof from === "string" && typeof to === "string") return `${from} – ${to}`
  }
  const horizon = result !== null && typeof result === "object" ? result["horizon_weeks"] : undefined
  if (typeof horizon === "number") return `${horizon} ${horizon === 1 ? "week" : "weken"} vooruit`
  return lookup.tool
}

export function DataLookups(props: { readonly lookups: ReadonlyArray<DataLookup> }) {
  if (props.lookups.length === 0) {
    return <p className="text-[13px] text-ink-2">Er is niets opgezocht voor deze vraag.</p>
  }
  const steps: Array<ToolStep> = props.lookups.map((lookup, index) => ({
    key: `${index}`,
    icon: <Database className="size-3.5" aria-hidden />,
    label: TOOL_TITLES[lookup.tool] ?? lookup.tool,
    chip: chipOf(lookup),
    mono: true,
    defaultOpen: true,
    testId: "data-lookup",
    detail: <DataValue value={lookup.result} />
  }))
  return (
    <section aria-label="Opgezochte gegevens" className="rounded-card bg-surface px-4 pt-3 pb-2 shadow-card">
      <ToolChips
        steps={steps}
        header={`${props.lookups.length} ${props.lookups.length === 1 ? "opzoeking" : "opzoekingen"} in uw gegevens`}
      />
    </section>
  )
}
