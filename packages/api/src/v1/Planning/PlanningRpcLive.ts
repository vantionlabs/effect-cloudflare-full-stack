/** `Planning.*` — the planning view and the expenses it counts, for the caller's organization. */
import { PlanningRpcs } from "@ea/modules/reporting/domain/Planning"
import type { ExpenseRepeat } from "@ea/modules/reporting/domain/Planning"
import { AddExpense, GetPlanning, ListExpenses, StopExpense } from "@ea/modules/reporting/use-cases/Planning"
import { Effect } from "effect"
import { serveForTenant } from "../Serve.ts"

export const PlanningRpcLive = PlanningRpcs.toLayer(
  Effect.succeed({
    "Planning.view": () => serveForTenant(GetPlanning),
    "Planning.expenses": () => serveForTenant(ListExpenses),
    "Planning.addExpense": (payload: {
      readonly description: string
      readonly amountCents: number
      readonly startsOn: string
      readonly repeat: ExpenseRepeat
    }) => serveForTenant(AddExpense(payload)),
    "Planning.stopExpense": (payload: { readonly expenseId: string }) => serveForTenant(StopExpense(payload.expenseId))
  })
)
