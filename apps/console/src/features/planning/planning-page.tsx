/**
 * Planning: work in progress, invoices, expenses, and the cash expected in and out over the next twelve weeks.
 *
 * Every figure is computed in code from jobs, invoices and expenses (`reporting/domain/Planning`); nothing here is a
 * model's estimate. The assumptions the forecast rests on — default payment terms, customers with their own terms,
 * how long an open job takes — are stated on the page, and so is its limit: the running net is the change from today,
 * not a balance.
 *
 * Server-rendered through Effect Atom hydration; each action is an RPC mutation that refreshes the forecast too.
 */
import { Notice } from "@/components/feedback/notice"
import { Page, PageHeader, PageSection } from "@/components/layout/page"
import { describeFailure } from "@/lib/failure"
import { plural } from "@/lib/format"
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
      <Page>
        <PageHeader title="Planning" />
        {planning._tag === "Failure"
          ? <Notice tone="error">Planning could not be loaded.</Notice>
          : <p role="status" className="text-sm text-ink-2">Loading…</p>}
      </Page>
    )
  }
  const plan = planning.value
  const { assumptions } = plan

  return (
    <Page width="wide">
      <PageHeader
        title="Planning"
        description={
          <>
            Work in progress, and the cash expected in and out. Assumes {assumptions.paymentTermsDays}-day payment terms
            {assumptions.customersWithOwnTerms > 0
              ? ` (${plural(assumptions.customersWithOwnTerms, "customer has", "customers have")} their own)`
              : ""} and open jobs finishing {assumptions.openJobDays} days after acceptance.
          </>
        }
      />

      <PlanningSummary plan={plan} />

      {note === undefined ? null : <Notice tone="error">{note}</Notice>}

      <CashForecast plan={plan} />

      <PageSection
        id="expenses"
        title="Expenses"
        description="Payments going out, once or every month. The forecast counts each on its payment day."
      >
        <ExpenseForm
          today={plan.today}
          onAdd={(expense) => act(addExpense({ payload: expense, reactivityKeys: EXPENSE_REFRESH }))}
        />
        <ExpenseList
          expenses={expenses._tag === "Success" ? expenses.value : []}
          onStop={(expenseId) => void act(stopExpense({ payload: { expenseId }, reactivityKeys: EXPENSE_REFRESH }))}
        />
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
