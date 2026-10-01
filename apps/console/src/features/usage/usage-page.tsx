/**
 * What this organization has used this month: the numbers an invoice would be built from.
 *
 * Rendered on the server with Effect Atom's SSR: the loader runs the `Usage.report` RPC atom on the server and
 * dehydrates it, and the page reads it inside `HydrationBoundary`. The page arrives with its figures, and the
 * browser does not fetch them again.
 *
 * Billable units first, cost second, and they are kept visibly apart — documents and decisions are what a customer
 * is charged for; tokens are what the platform pays, broken down by model.
 */
import { Notice } from "@/components/feedback/notice"
import { Page, PageHeader } from "@/components/layout/page"
import { formatDay } from "@/lib/format"
import { useAtomValue } from "@effect/atom-react"
import { usageReportAtom } from "./api/usage-atoms.ts"
import { BillableUsage } from "./components/billable-usage.tsx"
import { DailyUsage } from "./components/daily-usage.tsx"
import { ModelTokens } from "./components/model-tokens.tsx"
import { usageFigures } from "./usage-figures.ts"

/** `to` is exclusive, so the last day covered is the day before it. */
const lastDayBefore = (isoDay: string) =>
  new Date(Date.parse(`${isoDay}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)

export function UsagePage() {
  const result = useAtomValue(usageReportAtom)

  if (result._tag !== "Success") {
    return (
      <Page width="narrow">
        <PageHeader title="Usage" />
        {result._tag === "Failure"
          ? <Notice tone="error">Usage could not be loaded.</Notice>
          : <p role="status" className="text-sm text-ink-2">Loading usage…</p>}
      </Page>
    )
  }

  const report = result.value
  const figures = usageFigures(report)
  return (
    <Page width="narrow">
      <PageHeader
        title="Usage"
        description={`${formatDay(report.from)} to ${formatDay(lastDayBefore(report.to))} (UTC)`}
      />
      <BillableUsage documents={figures.documents} decisions={figures.decisions} />
      <ModelTokens models={figures.models} />
      <DailyUsage days={figures.days} />
    </Page>
  )
}
