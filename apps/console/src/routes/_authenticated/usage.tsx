/**
 * What this organization has used this month: the numbers an invoice would be built from.
 *
 * Rendered on the server with Effect Atom's SSR: the loader runs the `Usage.report` RPC atom on the server and
 * dehydrates it, and the page reads it inside `HydrationBoundary`. The page arrives with its figures, and the
 * browser does not fetch them again.
 *
 * Billable units first, cost second, and they are kept visibly apart — documents and decisions are what a customer
 * is charged for; tokens are what the platform pays, broken down by model because a 70B call and a small one
 * differ by an order of magnitude.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { loadUsagePage } from "@/usage/load-usage-page"
import { usageReportAtom } from "@/usage/usage-atoms"
import { HydrationBoundary, useAtomValue } from "@effect/atom-react"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/usage")({
  loader: () => loadUsagePage(),
  component: UsageRoute
})

function UsageRoute() {
  return (
    <HydrationBoundary state={Route.useLoaderData()}>
      <UsagePage />
    </HydrationBoundary>
  )
}

const number = new Intl.NumberFormat("en-GB")

function UsagePage() {
  const result = useAtomValue(usageReportAtom)

  if (result._tag !== "Success") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-sm" role={result._tag === "Failure" ? "alert" : "status"}>
          {result._tag === "Failure" ? "Usage could not be loaded." : "Loading usage…"}
        </p>
      </main>
    )
  }

  const report = result.value
  const total = (meter: string) =>
    report.totals.filter((row) => row.meter === meter).reduce((sum, row) => sum + row.quantity, 0)
  const models = [...new Set(report.totals.flatMap((row) => row.model === null ? [] : [row.model]))].sort()
  const tokens = (meter: string, model: string) =>
    report.totals.find((row) => row.meter === meter && row.model === model)?.quantity ?? 0
  const days = [...new Set(report.daily.map((row) => row.day))].sort()
  const daily = (day: string, meter: string) =>
    report.daily.find((row) => row.day === day && row.meter === meter)?.quantity ?? 0

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-lg font-medium">Usage</h1>
        {/* `to` is exclusive, so the last day shown is the day before it. */}
        <p className="text-muted-foreground text-sm">
          {report.from} to {report.to} (UTC, end exclusive)
        </p>
      </header>

      <section className="grid grid-cols-2 gap-4" aria-label="Billable usage">
        <Card>
          <CardHeader>
            <CardDescription>Documents ingested</CardDescription>
            <CardTitle className="text-2xl" data-meter="documents.ingested">
              {number.format(total("documents.ingested"))}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Decisions completed</CardDescription>
            <CardTitle className="text-2xl" data-meter="decisions.completed">
              {number.format(total("decisions.completed"))}
            </CardTitle>
          </CardHeader>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Model tokens</CardTitle>
          <CardDescription>Platform cost, by model. Not billed directly.</CardDescription>
        </CardHeader>
        <CardContent>
          {models.length === 0
            ? <p className="text-muted-foreground text-sm">No model calls this period.</p>
            : (
              <table className="w-full text-sm">
                <thead className="text-muted-foreground text-left">
                  <tr>
                    <th className="py-1 font-normal">Model</th>
                    <th className="py-1 text-right font-normal">Input</th>
                    <th className="py-1 text-right font-normal">Output</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((model) => (
                    <tr key={model} className="border-t">
                      <td className="py-1 font-mono text-xs">{model}</td>
                      <td className="py-1 text-right tabular-nums">
                        {number.format(tokens("model.input_tokens", model))}
                      </td>
                      <td className="py-1 text-right tabular-nums">
                        {number.format(tokens("model.output_tokens", model))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>By day</CardTitle>
        </CardHeader>
        <CardContent>
          {days.length === 0
            ? <p className="text-muted-foreground text-sm">Nothing recorded this period.</p>
            : (
              <table className="w-full text-sm">
                <thead className="text-muted-foreground text-left">
                  <tr>
                    <th className="py-1 font-normal">Day</th>
                    <th className="py-1 text-right font-normal">Documents</th>
                    <th className="py-1 text-right font-normal">Decisions</th>
                    <th className="py-1 text-right font-normal">Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((day) => (
                    <tr key={day} className="border-t">
                      <td className="py-1 tabular-nums">{day}</td>
                      <td className="py-1 text-right tabular-nums">
                        {number.format(daily(day, "documents.ingested"))}
                      </td>
                      <td className="py-1 text-right tabular-nums">
                        {number.format(daily(day, "decisions.completed"))}
                      </td>
                      <td className="py-1 text-right tabular-nums">
                        {number.format(daily(day, "model.input_tokens") + daily(day, "model.output_tokens"))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </CardContent>
      </Card>
    </main>
  )
}
