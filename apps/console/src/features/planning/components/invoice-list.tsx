/** Facturen with their due date, flagged late when open past it, and the payment that closes them. */
import { Button } from "@/components/atoms/Button"
import { DataTable } from "@/components/data/data-table"
import { StatusPill } from "@/components/data/status-pill"
import { PageSection } from "@/components/layout/page"
import FilterTable from "@/components/primitives/FilterTable"
import { useHydrated } from "@/hooks/use-hydrated"
import { formatDay, formatEuro } from "@/lib/format"
import type { Invoice } from "@ea/modules/sales/domain/Work"

type Standing = "open" | "late" | "paid"
const FILTERS = [
  { key: "open", label: "Open", dot: "var(--ink-3)" },
  { key: "late", label: "Te laat", dot: "var(--red)" },
  { key: "paid", label: "Betaald", dot: "var(--green)" }
] as const

export function InvoiceList(props: {
  readonly invoices: ReadonlyArray<Invoice>
  /** `YYYY-MM-DD`, from the planning view, so "te laat" agrees with the summary above it. */
  readonly today: string
  readonly onPay: (invoiceId: string) => void
}) {
  const hydrated = useHydrated()
  const standing = (row: Invoice): Standing =>
    row.status === "paid" ? "paid" : row.dueOn < props.today ? "late" : "open"
  return (
    <PageSection id="invoices" title="Facturen" description="Vervallen na de betalingstermijn van de klant.">
      <FilterTable
        rows={props.invoices}
        statusOf={standing}
        filters={FILTERS}
        allLabel="Alle"
        label="Facturen filteren"
      >
        {(shown) => (
          <DataTable<Invoice>
            caption="Facturen"
            rows={shown}
            rowKey={(invoice) => invoice.id}
            rowTestId="invoice"
            empty="Nog geen facturen. Een opdracht die klaar is, factureer je hierboven bij Opdrachten."
            columns={[
              { key: "customer", header: "Klant", cell: (row) => row.customerName ?? "Onbekende klant" },
              {
                key: "amount",
                header: "Bedrag",
                align: "right",
                cell: (row) => <span className="whitespace-nowrap">{formatEuro(row.amount)}</span>
              },
              {
                key: "status",
                header: "Status",
                cell: (row) => {
                  const now = standing(row)
                  if (now === "paid") {
                    return (
                      <StatusPill tone="green">
                        {`betaald${row.paidOn === null ? "" : ` op ${formatDay(row.paidOn)}`}`}
                      </StatusPill>
                    )
                  }
                  return (
                    <StatusPill tone={now === "late" ? "red" : "neutral"}>
                      {`${now === "late" ? "te laat — " : ""}vervalt ${formatDay(row.dueOn)}`}
                    </StatusPill>
                  )
                }
              },
              {
                key: "action",
                header: <span className="sr-only">Actie</span>,
                align: "right",
                cell: (row) =>
                  row.status === "open"
                    ? (
                      <Button size="sm" variant="primary" disabled={!hydrated} onClick={() => props.onPay(row.id)}>
                        Betaling vastleggen
                      </Button>
                    )
                    : null
              }
            ]}
          />
        )}
      </FilterTable>
    </PageSection>
  )
}
