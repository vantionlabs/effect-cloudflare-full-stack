import { DataTable } from "@/components/data/data-table"
import { PageSection } from "@/components/layout/page"
import { formatCount, formatDay } from "@/lib/format"
import type { UsageDay } from "../usage-figures.ts"

export function DailyUsage(props: { readonly days: ReadonlyArray<UsageDay> }) {
  return (
    <PageSection id="daily" title="By day">
      <DataTable<UsageDay>
        caption="Usage by day"
        rows={props.days}
        rowKey={(row) => row.day}
        empty="Nothing recorded this period."
        columns={[
          { key: "day", header: "Day", cell: (row) => formatDay(row.day) },
          { key: "documents", header: "Documents", align: "right", cell: (row) => formatCount(row.documents) },
          { key: "decisions", header: "Decisions", align: "right", cell: (row) => formatCount(row.decisions) },
          { key: "tokens", header: "Tokens", align: "right", cell: (row) => formatCount(row.tokens) }
        ]}
      />
    </PageSection>
  )
}
