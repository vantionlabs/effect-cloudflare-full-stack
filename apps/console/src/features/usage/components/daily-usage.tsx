import { DataTable } from "@/components/data/data-table"
import { PageSection } from "@/components/layout/page"
import { formatCount, formatDay } from "@/lib/format"
import type { UsageDay } from "../usage-figures.ts"

export function DailyUsage(props: { readonly days: ReadonlyArray<UsageDay> }) {
  return (
    <PageSection id="daily" title="Per dag">
      <DataTable<UsageDay>
        caption="Verbruik per dag"
        rows={props.days}
        rowKey={(row) => row.day}
        empty="Deze periode is er nog niets geregistreerd. Zodra er een document binnenkomt, verschijnt het hier."
        columns={[
          { key: "day", header: "Dag", cell: (row) => formatDay(row.day) },
          { key: "documents", header: "Documenten", align: "right", cell: (row) => formatCount(row.documents) },
          { key: "decisions", header: "Beslissingen", align: "right", cell: (row) => formatCount(row.decisions) },
          { key: "tokens", header: "Tokens", align: "right", cell: (row) => formatCount(row.tokens) }
        ]}
      />
    </PageSection>
  )
}
