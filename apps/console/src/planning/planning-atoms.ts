/**
 * The planning page's data and actions over RPC. Queries are serializable for SSR dehydration; every action
 * refreshes the planning view as well as its own list, because each one moves money between the view's figures.
 */
import { Api } from "@/rpc"

export const PLANNING_KEY = "planning"
export const JOBS_KEY = "jobs"
export const INVOICES_KEY = "invoices"

export const planningAtom = Api.query("Planning.view", {}, {
  serializationKey: "planning",
  reactivityKeys: [PLANNING_KEY]
})
export const jobsAtom = Api.query("Sales.jobs", {}, { serializationKey: "jobs", reactivityKeys: [JOBS_KEY] })
export const invoicesAtom = Api.query("Sales.invoices", {}, {
  serializationKey: "invoices",
  reactivityKeys: [INVOICES_KEY]
})

export const completeJobAtom = Api.mutation("Sales.completeJob")
export const invoiceJobAtom = Api.mutation("Sales.invoiceJob")
export const recordPaymentAtom = Api.mutation("Sales.recordPayment")
