/**
 * Verbruik: what this organization has used this period — the numbers an invoice would be built from.
 *
 * Rendered on the server with Effect Atom's SSR: the loader runs the `Usage.report` RPC atom on the server and
 * dehydrates it, and the page reads it inside `HydrationBoundary`. The page arrives with its figures, and the
 * browser does not fetch them again — unless the person asks, with "Vernieuwen". Then the figures stay on screen
 * while the new report loads, and a total that changed ROLLS to its new value (`RollingDigits`): the motion says
 * "this changed", which is exactly what happened.
 *
 * Billable units first, cost second, and they are kept visibly apart — documents and decisions are what a customer
 * is charged for; tokens are what the platform pays, broken down by model.
 */
import { Button } from "@/components/atoms/Button"
import { Notice } from "@/components/feedback/notice"
import { SkeletonStats, SkeletonTable } from "@/components/feedback/skeleton"
import { Page, PageHeader } from "@/components/layout/page"
import { useHydrated } from "@/hooks/use-hydrated"
import { formatDay } from "@/lib/format"
import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import { RefreshCw } from "lucide-react"
import { usageReportAtom } from "./api/usage-atoms.ts"
import { BillableUsage } from "./components/billable-usage.tsx"
import { DailyUsage } from "./components/daily-usage.tsx"
import { ModelTokens } from "./components/model-tokens.tsx"
import { usageFigures } from "./usage-figures.ts"

/** `to` is exclusive, so the last day covered is the day before it. */
const lastDayBefore = (isoDay: string) =>
  new Date(Date.parse(`${isoDay}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)

const DESCRIPTION = "Wat uw organisatie deze periode heeft gebruikt — de aantallen waar een factuur op gebaseerd is."

export function UsagePage() {
  const result = useAtomValue(usageReportAtom)
  const refresh = useAtomRefresh(usageReportAtom)
  const hydrated = useHydrated()

  if (result._tag !== "Success") {
    return (
      <Page width="narrow">
        <PageHeader title="Verbruik" description={DESCRIPTION} />
        {result._tag === "Failure"
          ? <Notice tone="error">Het verbruik kon niet worden geladen.</Notice>
          : (
            <>
              <SkeletonStats count={2} label="Verbruik laden" />
              <SkeletonTable rows={3} columns={3} label="Tokens per model laden" />
            </>
          )}
      </Page>
    )
  }

  const report = result.value
  const figures = usageFigures(report)
  return (
    <Page width="narrow">
      <PageHeader
        title="Verbruik"
        description={
          <>
            {DESCRIPTION}{" "}
            <span className="whitespace-nowrap text-ink-3">
              {formatDay(report.from)} t/m {formatDay(lastDayBefore(report.to))} (UTC)
            </span>
          </>
        }
        actions={
          <Button variant="secondary" size="sm" disabled={!hydrated || result.waiting} onClick={refresh}>
            <RefreshCw className={`size-3.5 ${result.waiting ? "animate-spin" : ""}`} aria-hidden />
            {result.waiting ? "Bezig met vernieuwen…" : "Vernieuwen"}
          </Button>
        }
      />
      <div aria-busy={result.waiting} className="flex flex-col gap-8">
        <BillableUsage documents={figures.documents} decisions={figures.decisions} />
        <ModelTokens models={figures.models} />
        <DailyUsage days={figures.days} />
      </div>
    </Page>
  )
}
