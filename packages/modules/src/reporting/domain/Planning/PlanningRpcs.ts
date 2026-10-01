/** The planning view — work in progress, expected cash in and out — and the expenses it counts. */
import { AuthenticatedRpc } from "@ea/domain/Identity"
import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { ExpenseNotFound } from "../Errors/ExpenseNotFound.ts"
import { InvalidExpense } from "../Errors/InvalidExpense.ts"
import { Expense, ExpenseRepeat } from "./Expense.ts"
import { PlanningView } from "./Planning.ts"

export const PlanningRpcs = RpcGroup.make(
  Rpc.make("Planning.view", { payload: {}, success: PlanningView }),
  Rpc.make("Planning.expenses", { payload: {}, success: Schema.Array(Expense) }),
  Rpc.make("Planning.addExpense", {
    payload: {
      description: Schema.String,
      /** Cents, VAT included. */
      amountCents: Schema.Int,
      /** `YYYY-MM-DD`: the day a one-off is paid, or the first payment of a monthly one. */
      startsOn: Schema.String,
      repeat: ExpenseRepeat
    },
    success: Schema.Array(Expense),
    error: InvalidExpense
  }),
  /** Stops a monthly expense from today, or withdraws a one-off. The row stays, with the day it stopped. */
  Rpc.make("Planning.stopExpense", {
    payload: { expenseId: Schema.String },
    success: Schema.Array(Expense),
    error: ExpenseNotFound
  })
).middleware(AuthenticatedRpc)
