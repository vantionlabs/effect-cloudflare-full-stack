/**
 * Where the money is, in one strip: being worked on, ready to bill, billed, late — and what the next twelve weeks
 * add up to. One surface with hairline dividers rather than four identical stat cards, because these are one sentence
 * read left to right ("this much is in progress, this much is ready to invoice…"), not five separate metrics.
 *
 * Each figure ROLLS when it changes after an action (Beautiful UI's odometer), so marking a job done visibly moves
 * its value from one column to the next. Nothing rolls on first render: the page arrives with its figures.
 */
import { RollingDigits } from "@/components/motion/rolling-digits"
import { formatEuro, plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { PlanningView } from "@ea/modules/reporting/domain/Planning"
import type { ReactNode } from "react"

function Figure(props: {
  readonly label: string
  readonly cents: number
  readonly detail: ReactNode
  readonly testId: string
  readonly tone?: "default" | "warning" | "signed"
}) {
  const tone = props.tone === "warning" && props.cents > 0
    ? "text-orange"
    : props.tone === "signed" && props.cents < 0
    ? "text-red"
    : "text-ink"
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-4 py-3">
      <dt className="text-[12px] font-medium text-ink-2">{props.label}</dt>
      <dd className={cn("tabular text-[17px] font-semibold", tone)} data-testid={props.testId}>
        <RollingDigits value={formatEuro(props.cents)} />
      </dd>
      <dd className="text-[12px] text-ink-3">{props.detail}</dd>
    </div>
  )
}

export function PlanningSummary(props: { readonly plan: PlanningView }) {
  const { plan } = props
  const twelveWeeks = plan.weeks.at(-1)?.runningNet ?? 0
  return (
    <section aria-label="Overzicht">
      <dl className="grid grid-cols-2 divide-line rounded-card bg-surface shadow-card max-lg:divide-y lg:grid-cols-5 lg:divide-x">
        <Figure
          label="Onderhanden werk"
          cents={plan.workInProgress.openJobs.cents}
          detail={plural(plan.workInProgress.openJobs.count, "opdracht", "opdrachten")}
          testId="wip-open"
        />
        <Figure
          label="Klaar om te factureren"
          cents={plan.workInProgress.doneNotInvoiced.cents}
          detail={plural(plan.workInProgress.doneNotInvoiced.count, "opdracht", "opdrachten")}
          testId="wip-done"
        />
        <Figure
          label="Openstaande facturen"
          cents={plan.openInvoices.cents}
          detail={plural(plan.openInvoices.count, "factuur", "facturen")}
          testId="open-invoices"
        />
        <Figure
          label="Te laat betaald"
          cents={plan.overdue.cents}
          detail={plural(plan.overdue.count, "factuur", "facturen")}
          tone="warning"
          testId="overdue"
        />
        <Figure
          label="Verschil over 12 weken"
          cents={twelveWeeks}
          detail="geen banksaldo"
          tone="signed"
          testId="net-twelve-weeks"
        />
      </dl>
    </section>
  )
}
