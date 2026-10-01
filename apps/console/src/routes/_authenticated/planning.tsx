/**
 * Planning: work in progress, invoices, and the cash expected to come in over the next twelve weeks.
 *
 * Every figure is computed in code from jobs and invoices (`reporting/domain/Planning`); nothing here is a model's
 * estimate. The assumptions the forecast rests on — payment terms, how long an open job takes — are stated on the
 * page, and so is its limit: it counts money coming IN, because the product records no expenses.
 *
 * Server-rendered through Effect Atom hydration; each action is an RPC mutation that refreshes the forecast too.
 */
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useHydrated } from "@/hooks/use-hydrated"
import { loadPlanningPage } from "@/planning/load-planning-page"
import {
  completeJobAtom,
  invoiceJobAtom,
  INVOICES_KEY,
  invoicesAtom,
  JOBS_KEY,
  jobsAtom,
  PLANNING_KEY,
  planningAtom,
  recordPaymentAtom
} from "@/planning/planning-atoms"
import { HydrationBoundary, useAtomSet, useAtomValue } from "@effect/atom-react"
import { createFileRoute } from "@tanstack/react-router"
import { Cause, Exit } from "effect"
import { useState } from "react"

export const Route = createFileRoute("/_authenticated/planning")({
  loader: () => loadPlanningPage(),
  component: PlanningRoute
})

function PlanningRoute() {
  return (
    <HydrationBoundary state={Route.useLoaderData()}>
      <PlanningPage />
    </HydrationBoundary>
  )
}

const euro = (cents: number) =>
  `€ ${(cents / 100).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const REFRESH = [PLANNING_KEY, JOBS_KEY, INVOICES_KEY]

function Figure(
  props: { readonly label: string; readonly count: number; readonly cents: number; readonly testId: string }
) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{props.label}</CardDescription>
        <CardTitle className="text-xl tabular-nums" data-testid={props.testId}>{euro(props.cents)}</CardTitle>
        <CardDescription>{props.count} {props.count === 1 ? "item" : "items"}</CardDescription>
      </CardHeader>
    </Card>
  )
}

function PlanningPage() {
  const hydrated = useHydrated()
  const planning = useAtomValue(planningAtom)
  const jobs = useAtomValue(jobsAtom)
  const invoices = useAtomValue(invoicesAtom)
  const complete = useAtomSet(completeJobAtom, { mode: "promiseExit" })
  const invoice = useAtomSet(invoiceJobAtom, { mode: "promiseExit" })
  const pay = useAtomSet(recordPaymentAtom, { mode: "promiseExit" })
  const [note, setNote] = useState<string | undefined>(undefined)

  const act = async (exit: Promise<Exit.Exit<unknown, unknown>>) => {
    setNote(undefined)
    const result = await exit
    if (Exit.isFailure(result)) {
      const failure = Cause.findErrorOption(result.cause as Cause.Cause<{ readonly _tag?: string }>)
      setNote(
        failure._tag === "Some" &&
          (failure.value._tag === "JobNotInState" || failure.value._tag === "InvoiceAlreadyPaid")
          ? "Someone already did that. The page has been refreshed."
          : "That did not work."
      )
    }
  }

  if (planning._tag !== "Success") {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8 text-sm">
        {planning._tag === "Failure" ? "Planning could not be loaded." : "Loading…"}
      </main>
    )
  }
  const plan = planning.value
  const today = plan.today

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-lg font-medium">Planning</h1>
        <p className="text-muted-foreground text-sm">
          Work in progress and the cash expected to come in. Assumes{" "}
          {plan.assumptions.paymentTermsDays}-day payment terms and open jobs finishing {plan.assumptions.openJobDays}
          {" "}
          days after acceptance. Money coming in only — expenses are not recorded.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4" aria-label="Summary">
        <Figure
          label="Open jobs"
          count={plan.workInProgress.openJobs.count}
          cents={plan.workInProgress.openJobs.cents}
          testId="wip-open"
        />
        <Figure
          label="Done, not invoiced"
          count={plan.workInProgress.doneNotInvoiced.count}
          cents={plan.workInProgress.doneNotInvoiced.cents}
          testId="wip-done"
        />
        <Figure
          label="Open invoices"
          count={plan.openInvoices.count}
          cents={plan.openInvoices.cents}
          testId="open-invoices"
        />
        <Figure label="Overdue" count={plan.overdue.count} cents={plan.overdue.cents} testId="overdue" />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Expected cash in</CardTitle>
          <CardDescription>
            Sent quotes not yet answered ({euro(plan.pipeline.cents)}) are pipeline and are not counted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm" aria-label="Forecast">
            <thead className="text-muted-foreground text-left">
              <tr>
                <th className="py-1 font-normal">Week of</th>
                <th className="py-1 text-right font-normal">Invoices</th>
                <th className="py-1 text-right font-normal">Work</th>
                <th className="py-1 text-right font-normal">Total</th>
              </tr>
            </thead>
            <tbody>
              {plan.weeks.map((week) => (
                <tr key={week.weekStart} className="border-t">
                  <td className="py-1 tabular-nums">{week.weekStart}</td>
                  <td className="py-1 text-right tabular-nums">{euro(week.fromInvoices)}</td>
                  <td className="py-1 text-right tabular-nums">{euro(week.fromWork)}</td>
                  <td className="py-1 text-right font-medium tabular-nums">{euro(week.total)}</td>
                </tr>
              ))}
              <tr className="border-t">
                <td className="text-muted-foreground py-1">Later</td>
                <td />
                <td />
                <td className="py-1 text-right tabular-nums">{euro(plan.later)}</td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      {note === undefined ? null : <p className="text-sm" role="alert">{note}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Jobs</CardTitle>
          <CardDescription>Created when a customer accepts a quote.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          {jobs._tag !== "Success" || jobs.value.length === 0 ?
            <p className="text-muted-foreground">No jobs yet.</p> :
            (
              <table className="w-full" aria-label="Jobs">
                <tbody>
                  {jobs.value.map((job) => (
                    <tr key={job.id} className="border-t" data-testid="job">
                      <td className="py-1">{job.customerName ?? "Unknown customer"}</td>
                      <td className="py-1 tabular-nums">{euro(job.value)}</td>
                      <td className="text-muted-foreground py-1" data-testid="job-status">{job.status}</td>
                      <td className="py-1 text-right">
                        {job.status === "open"
                          ? (
                            <Button
                              size="sm"
                              disabled={!hydrated}
                              onClick={() =>
                                void act(complete({ payload: { jobId: job.id }, reactivityKeys: REFRESH }))}
                            >
                              Mark done
                            </Button>
                          )
                          : job.status === "done"
                          ? (
                            <Button
                              size="sm"
                              disabled={!hydrated}
                              onClick={() => void act(invoice({ payload: { jobId: job.id }, reactivityKeys: REFRESH }))}
                            >
                              Invoice
                            </Button>
                          )
                          : null}
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
          <CardTitle>Invoices</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {invoices._tag !== "Success" || invoices.value.length === 0 ?
            <p className="text-muted-foreground">No invoices yet.</p> :
            (
              <table className="w-full" aria-label="Invoices">
                <tbody>
                  {invoices.value.map((row) => {
                    const overdue = row.status === "open" && row.dueOn < today
                    return (
                      <tr key={row.id} className="border-t" data-testid="invoice">
                        <td className="py-1">{row.customerName ?? "Unknown customer"}</td>
                        <td className="py-1 tabular-nums">{euro(row.amount)}</td>
                        <td className={`py-1 tabular-nums ${overdue ? "text-red-600" : "text-muted-foreground"}`}>
                          {row.status === "paid"
                            ? `paid ${row.paidOn}`
                            : `due ${row.dueOn}${overdue ? " — overdue" : ""}`}
                        </td>
                        <td className="py-1 text-right">
                          {row.status === "open"
                            ? (
                              <Button
                                size="sm"
                                disabled={!hydrated}
                                onClick={() =>
                                  void act(pay({ payload: { invoiceId: row.id }, reactivityKeys: REFRESH }))}
                              >
                                Record payment
                              </Button>
                            )
                            : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
        </CardContent>
      </Card>
    </main>
  )
}
