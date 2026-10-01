/** The four headline figures: what is being worked on, what is ready to bill, what is billed, and what is late. */
import { Stat, StatGrid } from "@/components/data/stat"
import { formatEuro, plural } from "@/lib/format"
import type { PlanningView } from "@ea/modules/reporting/domain/Planning"

export function PlanningSummary(props: { readonly plan: PlanningView }) {
  const { plan } = props
  return (
    <section aria-label="Summary">
      <StatGrid>
        <Stat
          label="Open jobs"
          value={formatEuro(plan.workInProgress.openJobs.cents)}
          detail={plural(plan.workInProgress.openJobs.count, "job")}
          testId="wip-open"
        />
        <Stat
          label="Done, not invoiced"
          value={formatEuro(plan.workInProgress.doneNotInvoiced.cents)}
          detail={plural(plan.workInProgress.doneNotInvoiced.count, "job")}
          testId="wip-done"
        />
        <Stat
          label="Open invoices"
          value={formatEuro(plan.openInvoices.cents)}
          detail={plural(plan.openInvoices.count, "invoice")}
          testId="open-invoices"
        />
        <Stat
          label="Overdue"
          value={formatEuro(plan.overdue.cents)}
          detail={plural(plan.overdue.count, "invoice")}
          tone={plan.overdue.count > 0 ? "warning" : "default"}
          testId="overdue"
        />
      </StatGrid>
    </section>
  )
}
