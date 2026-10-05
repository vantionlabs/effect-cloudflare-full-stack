/**
 * Where the cash going out over the forecast goes: each expense's share of the twelve weeks' outflow.
 *
 * Counted with the domain's own `expenseDates` — the function `planCash` uses — over the same window (today to the end
 * of the last forecast week), so the parts add up to exactly the forecast's "Uit" column and cannot disagree with it.
 * Shown only with two or more expenses that pay in the window: one full bar says nothing.
 */
import AllocationCard from "@/components/primitives/AllocationCard"
import { formatEuro } from "@/lib/format"
import { type Expense, expenseDates, FORECAST_WEEKS, type PlanningView } from "@ea/modules/reporting/domain/Planning"

const DAY_MS = 86_400_000

export function ExpenseAllocation(props: { readonly plan: PlanningView; readonly expenses: ReadonlyArray<Expense> }) {
  const first = props.plan.weeks[0]
  if (first === undefined) return null
  const from = Date.parse(`${props.plan.today}T00:00:00Z`)
  const to = Date.parse(`${first.weekStart}T00:00:00Z`) + FORECAST_WEEKS * 7 * DAY_MS
  const parts = props.expenses
    .map((expense) => {
      const payments = expenseDates(expense, from, to).length
      return { expense, payments, cents: payments * expense.amountCents }
    })
    .filter((part) => part.cents > 0)
    .sort((a, b) => b.cents - a.cents)
  if (parts.length < 2) return null
  const total = parts.reduce((sum, part) => sum + part.cents, 0)
  return (
    <AllocationCard
      title="Uitgaven in de komende 12 weken"
      total={formatEuro(total)}
      segments={parts.map((part) => ({
        key: part.expense.id,
        label: part.expense.description,
        value: part.cents,
        display: formatEuro(part.cents),
        detail: part.payments === 1
          ? `Eén betaling van ${formatEuro(part.expense.amountCents)}.`
          : `${part.payments} betalingen van ${formatEuro(part.expense.amountCents)}.`
      }))}
    />
  )
}
