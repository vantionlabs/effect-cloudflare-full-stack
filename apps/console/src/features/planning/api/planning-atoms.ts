/**
 * The planning page's data and actions over RPC. Queries are serializable for SSR dehydration; every action
 * refreshes the planning view as well as its own list, because each one moves money between the view's figures.
 */
import { Api } from "@/rpc/client"

const PLANNING_KEY = "planning"
const JOBS_KEY = "jobs"
const INVOICES_KEY = "invoices"
const EXPENSES_KEY = "expenses"

export const planningAtom = Api.query("Planning.view", {}, {
  serializationKey: "planning",
  reactivityKeys: [PLANNING_KEY]
})
export const jobsAtom = Api.query("Sales.jobs", {}, { serializationKey: "jobs", reactivityKeys: [JOBS_KEY] })
export const invoicesAtom = Api.query("Sales.invoices", {}, {
  serializationKey: "invoices",
  reactivityKeys: [INVOICES_KEY]
})
export const expensesAtom = Api.query("Planning.expenses", {}, {
  serializationKey: "expenses",
  reactivityKeys: [EXPENSES_KEY]
})

export const completeJobAtom = Api.mutation("Sales.completeJob")
export const invoiceJobAtom = Api.mutation("Sales.invoiceJob")
export const recordPaymentAtom = Api.mutation("Sales.recordPayment")
export const addExpenseAtom = Api.mutation("Planning.addExpense")
export const stopExpenseAtom = Api.mutation("Planning.stopExpense")

/** Every action on this page changes the forecast, so each refreshes it along with its own list. */
export const WORK_REFRESH = [PLANNING_KEY, JOBS_KEY, INVOICES_KEY]
export const EXPENSE_REFRESH = [PLANNING_KEY, EXPENSES_KEY]
