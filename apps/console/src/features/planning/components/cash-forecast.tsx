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

const signed = (cents: number) => (
  <span className={cn("whitespace-nowrap", cents < 0 && "text-red")}>{formatEuro(cents)}</span>
)
// `whitespace-nowrap` on every figure: on a phone the table scrolls sideways rather than breaking "€" from "0,00".
const quiet = (cents: number) => (
  <span className={cn("whitespace-nowrap", cents === 0 && "text-ink-3")}>{formatEuro(cents)}</span>
)

export function CashForecast(props: { readonly plan: PlanningView }) {
  const { plan } = props
  return (
    <PageSection
      id="forecast"
      title="Kasstroomprognose"
      description={`Verstuurde offertes zonder antwoord (${
        formatEuro(plan.pipeline.cents)
      }) tellen nog niet mee. Uitgaven tellen op hun betaaldag.`}
    >
      <DataTable<Week>
        caption="Prognose"
        rows={plan.weeks}
        rowKey={(week) => week.weekStart}
        empty="Geen prognose."
        columns={[
          {
            key: "week",
            header: "Week van",
            cell: (week) => <span className="whitespace-nowrap">{formatDay(week.weekStart)}</span>
          },
          // The breakdown of "In": hidden on phones, where In, Uit and Netto are what fits and what matters.
          {
            key: "invoices",
            header: "Facturen",
            align: "right",
            priority: "secondary",
            cell: (week) => quiet(week.fromInvoices)
          },
          { key: "work", header: "Werk", align: "right", priority: "secondary", cell: (week) => quiet(week.fromWork) },
          { key: "in", header: "In", align: "right", cell: (week) => quiet(week.total) },
          { key: "out", header: "Uit", align: "right", cell: (week) => quiet(week.out) },
          { key: "net", header: "Netto", align: "right", cell: (week) => signed(week.net) },
          {
            key: "running",
            header: <span title="De optelsom van netto tot en met deze week. Geen banksaldo.">Verschil t.o.v. nu</span>,
            align: "right",
            cell: (week) => signed(week.runningNet)
          }
        ]}
      />
      <p className="text-[12px] text-ink-3">
        Verwacht na deze twaalf weken:{" "}
        <span className="tabular">{formatEuro(plan.later)}</span>. ‘Verschil t.o.v. nu’ is hoeveel geld er vanaf vandaag
        bij komt of af gaat — geen banksaldo; dat kent dit product niet.
      </p>
    </PageSection>
  )
}
