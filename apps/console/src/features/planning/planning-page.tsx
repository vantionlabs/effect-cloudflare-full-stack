/**
 * Planning: work in progress, invoices, expenses, and the cash expected in and out over the next twelve weeks.
 *
 * While an action's refresh is in flight the figures stay on screen, dimmed (`superseded`) — they are about to be
 * replaced, and a page that blanked out on every click would read as broken.
 *
 * Every figure is computed in code from jobs, invoices and expenses (`reporting/domain/Planning`); nothing here is a
 * model's estimate. The assumptions the forecast rests on — default payment terms, customers with their own terms,
 * how long an open job takes — are stated on the page, and so is its limit: the running net is the change from today,
 * not a balance.
 *
 * Server-rendered through Effect Atom hydration; each action is an RPC mutation that refreshes the forecast too.
 */
import { Notice } from "@/components/feedback/notice"
import { SkeletonStats, SkeletonTable } from "@/components/feedback/skeleton"
import { Page, PageHeader, PageSection } from "@/components/layout/page"
import { describeFailure } from "@/lib/failure"
import { plural } from "@/lib/format"
import { superseded } from "@/lib/motion"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Exit } from "effect"
import { useState } from "react"
import {
  addExpenseAtom,
  completeJobAtom,
  EXPENSE_REFRESH,
  expensesAtom,
  invoiceJobAtom,
  invoicesAtom,
  jobsAtom,
  planningAtom,
  recordPaymentAtom,
  stopExpenseAtom,
  WORK_REFRESH
} from "./api/planning-atoms.ts"
import { CashForecast } from "./components/cash-forecast.tsx"
import { ExpenseAllocation } from "./components/expense-allocation.tsx"
import { ExpenseForm } from "./components/expense-form.tsx"
import { ExpenseList } from "./components/expense-list.tsx"
import { InvoiceList } from "./components/invoice-list.tsx"
import { JobList } from "./components/job-list.tsx"
import { PlanningSummary } from "./components/planning-summary.tsx"
import { PLANNING_FAILURES } from "./planning-failures.ts"

export function PlanningPage() {
  const planning = useAtomValue(planningAtom)
  const jobs = useAtomValue(jobsAtom)
  const invoices = useAtomValue(invoicesAtom)
  const expenses = useAtomValue(expensesAtom)
  const complete = useAtomSet(completeJobAtom, { mode: "promiseExit" })
  const invoice = useAtomSet(invoiceJobAtom, { mode: "promiseExit" })
  const pay = useAtomSet(recordPaymentAtom, { mode: "promiseExit" })
  const addExpense = useAtomSet(addExpenseAtom, { mode: "promiseExit" })
  const stopExpense = useAtomSet(stopExpenseAtom, { mode: "promiseExit" })
  const [note, setNote] = useState<string | undefined>(undefined)

  /** Runs an action and says why it failed, if it did. Resolves true on success. */
  const act = async (exit: Promise<Exit.Exit<unknown, unknown>>): Promise<boolean> => {
    setNote(undefined)
    const result = await exit
    if (Exit.isSuccess(result)) return true
    setNote(describeFailure(result, PLANNING_FAILURES))
    return false
  }

  if (planning._tag !== "Success") {
    return (
      <Page width="wide">
        <PageHeader title="Planning" />
        {planning._tag === "Failure"
          ? <Notice tone="error">De planning kon niet worden geladen.</Notice>
          : (
            <>
              <SkeletonStats count={5} label="Overzicht wordt geladen" />
              <SkeletonTable rows={6} columns={6} label="Prognose wordt geladen" />
            </>
          )}
      </Page>
    )
  }
  const refreshing = planning.waiting
  const plan = planning.value
  const { assumptions } = plan

  return (
    <Page width="wide">
      <PageHeader
        title="Planning"
        description={
          <>
            Onderhanden werk en het geld dat de komende weken binnenkomt en uitgaat. Uitgangspunten: een
            betalingstermijn van {assumptions.paymentTermsDays} dagen
            {assumptions.customersWithOwnTerms > 0
              ? ` (${plural(assumptions.customersWithOwnTerms, "klant heeft", "klanten hebben")} een eigen termijn)`
              : ""}, en een lopende opdracht is {assumptions.openJobDays} dagen na akkoord klaar.
          </>
        }
      />

      <div className="flex flex-col gap-8" style={superseded(refreshing)} aria-busy={refreshing}>
        <PlanningSummary plan={plan} />
        {note === undefined ? null : <Notice tone="error">{note}</Notice>}
        <CashForecast plan={plan} />
      </div>

      <PageSection
        id="expenses"
        title="Uitgaven"
        description="Betalingen die eenmalig of elke maand de deur uit gaan. De prognose telt ze op hun betaaldag."
      >
        <ExpenseForm
          today={plan.today}
          onAdd={(expense) => act(addExpense({ payload: expense, reactivityKeys: EXPENSE_REFRESH }))}
        />
        {expenses._tag === "Initial"
          ? <SkeletonTable rows={2} columns={3} label="Uitgaven worden geladen" />
          : (
            <>
              <ExpenseList
                expenses={expenses._tag === "Success" ? expenses.value : []}
                onStop={(expenseId) =>
                  void act(stopExpense({ payload: { expenseId }, reactivityKeys: EXPENSE_REFRESH }))}
              />
              <ExpenseAllocation plan={plan} expenses={expenses._tag === "Success" ? expenses.value : []} />
            </>
          )}
      </PageSection>

      <JobList
        jobs={jobs._tag === "Success" ? jobs.value : []}
        onComplete={(jobId) => void act(complete({ payload: { jobId }, reactivityKeys: WORK_REFRESH }))}
        onInvoice={(jobId) => void act(invoice({ payload: { jobId }, reactivityKeys: WORK_REFRESH }))}
      />

      <InvoiceList
        invoices={invoices._tag === "Success" ? invoices.value : []}
        today={plan.today}
        onPay={(invoiceId) => void act(pay({ payload: { invoiceId }, reactivityKeys: WORK_REFRESH }))}
      />
    </Page>
  )
}
