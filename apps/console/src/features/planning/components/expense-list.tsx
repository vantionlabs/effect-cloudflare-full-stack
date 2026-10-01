/** Uitgaven the forecast counts. Stopping one keeps the record; it just stops paying from today. */
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
      caption="Uitgaven"
      rows={props.expenses}
      rowKey={(expense) => expense.id}
      rowTestId="expense"
      empty="Nog geen uitgaven. Zolang je er geen toevoegt, laat de prognose alleen geld zien dat binnenkomt."
      columns={[
        { key: "description", header: "Omschrijving", cell: (expense) => expense.description },
        {
          key: "amount",
          header: "Bedrag",
          align: "right",
          cell: (expense) => <span className="whitespace-nowrap">{formatEuro(expense.amountCents)}</span>
        },
        {
          key: "when",
          header: "Wanneer",
          cell: (expense) =>
            expense.repeat === "monthly"
              ? <StatusPill tone="accent">{`maandelijks vanaf ${formatDay(expense.startsOn)}`}</StatusPill>
              : <StatusPill tone="neutral">{`eenmalig op ${formatDay(expense.startsOn)}`}</StatusPill>
        },
        {
          key: "action",
          header: <span className="sr-only">Actie</span>,
          align: "right",
          cell: (expense) => (
            <Button
              size="sm"
              variant="secondary"
              disabled={!hydrated}
              onClick={() => props.onStop(expense.id)}
            >
              {expense.repeat === "monthly" ? "Stoppen" : "Verwijderen"}
            </Button>
          )
        }
      ]}
    />
  )
}
