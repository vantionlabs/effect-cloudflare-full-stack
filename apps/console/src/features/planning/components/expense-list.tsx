/** Expenses the forecast counts. Stopping one keeps the record; it just stops paying from today. */
import { Button } from "@/components/atoms/Button"
import { DataTable } from "@/components/data/data-table"
import { StatusPill } from "@/components/data/status-pill"
import { useHydrated } from "@/hooks/use-hydrated"
import { formatDay, formatEuro } from "@/lib/format"
import type { Expense } from "@ea/modules/reporting/domain/Planning"

export function ExpenseList(props: {
  readonly expenses: ReadonlyArray<Expense>
  readonly onStop: (expenseId: string) => void
}) {
  const hydrated = useHydrated()
  return (
    <DataTable<Expense>
      caption="Expenses"
      rows={props.expenses}
      rowKey={(expense) => expense.id}
      rowTestId="expense"
      empty="No expenses recorded. The forecast shows cash in only until you add some."
      columns={[
        { key: "description", header: "Description", cell: (expense) => expense.description },
        { key: "amount", header: "Amount", align: "right", cell: (expense) => formatEuro(expense.amountCents) },
        {
          key: "when",
          header: "When",
          cell: (expense) =>
            expense.repeat === "monthly"
              ? <StatusPill tone="accent">{`monthly from ${formatDay(expense.startsOn)}`}</StatusPill>
              : <StatusPill tone="neutral">{`once on ${formatDay(expense.startsOn)}`}</StatusPill>
        },
        {
          key: "action",
          header: <span className="sr-only">Action</span>,
          align: "right",
          cell: (expense) => (
            <Button
              size="sm"
              variant="secondary"
              disabled={!hydrated}
              onClick={() => props.onStop(expense.id)}
            >
              {expense.repeat === "monthly" ? "Stop" : "Remove"}
            </Button>
          )
        }
      ]}
    />
  )
}
