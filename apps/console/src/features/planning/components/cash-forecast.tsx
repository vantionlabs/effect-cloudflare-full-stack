/**
 * Cash in, cash out and net per week for twelve weeks.
 *
 * The last column is a RUNNING net — the change in cash from today — and is labelled as such. The product does not
 * know the bank balance, and a column that looked like one would be read as one.
 */
import { DataTable } from "@/components/data/data-table"
import { PageSection } from "@/components/layout/page"
import { formatDay, formatEuro } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { PlanningView } from "@ea/modules/reporting/domain/Planning"

type Week = PlanningView["weeks"][number]

const signed = (cents: number) => <span className={cn(cents < 0 && "text-red")}>{formatEuro(cents)}</span>

export function CashForecast(props: { readonly plan: PlanningView }) {
  const { plan } = props
  return (
    <PageSection
      id="forecast"
      title="Cash forecast"
      description={`Sent quotes not yet answered (${
        formatEuro(plan.pipeline.cents)
      }) are pipeline and not counted. Expenses are counted on their payment day.`}
    >
      <DataTable<Week>
        caption="Forecast"
        rows={plan.weeks}
        rowKey={(week) => week.weekStart}
        empty="No forecast."
        columns={[
          { key: "week", header: "Week of", cell: (week) => formatDay(week.weekStart) },
          { key: "invoices", header: "Invoices", align: "right", cell: (week) => formatEuro(week.fromInvoices) },
          { key: "work", header: "Work", align: "right", cell: (week) => formatEuro(week.fromWork) },
          { key: "in", header: "Cash in", align: "right", cell: (week) => formatEuro(week.total) },
          { key: "out", header: "Cash out", align: "right", cell: (week) => formatEuro(week.out) },
          { key: "net", header: "Net", align: "right", cell: (week) => signed(week.net) },
          {
            key: "running",
            header: <span title="The sum of net up to this week. Not a bank balance.">Change from today</span>,
            align: "right",
            cell: (week) => signed(week.runningNet)
          }
        ]}
      />
      <p className="text-[12px] text-ink-3">
        Expected in after these twelve weeks:{" "}
        <span className="tabular">{formatEuro(plan.later)}</span>. “Change from today” is how much cash goes up or down
        from now — not a bank balance, which this product does not know.
      </p>
    </PageSection>
  )
}
