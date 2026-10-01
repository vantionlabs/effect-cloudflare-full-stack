/** Invoices with their due date, flagged overdue when open past it, and the payment that closes them. */
import { Button } from "@/components/atoms/Button"
import { DataTable } from "@/components/data/data-table"
import { StatusPill } from "@/components/data/status-pill"
import { PageSection } from "@/components/layout/page"
import { useHydrated } from "@/hooks/use-hydrated"
import { formatDay, formatEuro } from "@/lib/format"
import type { Invoice } from "@ea/modules/sales/domain/Work"

export function InvoiceList(props: {
  readonly invoices: ReadonlyArray<Invoice>
  /** `YYYY-MM-DD`, from the planning view, so "overdue" agrees with the summary above it. */
  readonly today: string
  readonly onPay: (invoiceId: string) => void
}) {
  const hydrated = useHydrated()
  return (
    <PageSection id="invoices" title="Invoices" description="Due after the customer's payment terms.">
      <DataTable<Invoice>
        caption="Invoices"
        rows={props.invoices}
        rowKey={(invoice) => invoice.id}
        rowTestId="invoice"
        empty="No invoices yet."
        columns={[
          { key: "customer", header: "Customer", cell: (row) => row.customerName ?? "Unknown customer" },
          { key: "amount", header: "Amount", align: "right", cell: (row) => formatEuro(row.amount) },
          {
            key: "status",
            header: "Status",
            cell: (row) => {
              if (row.status === "paid") {
                return (
                  <StatusPill tone="green">{`paid ${row.paidOn === null ? "" : formatDay(row.paidOn)}`}</StatusPill>
                )
              }
              const overdue = row.dueOn < props.today
              return (
                <StatusPill tone={overdue ? "red" : "neutral"}>
                  {`due ${formatDay(row.dueOn)}${overdue ? " — overdue" : ""}`}
                </StatusPill>
              )
            }
          },
          {
            key: "action",
            header: <span className="sr-only">Action</span>,
            align: "right",
            cell: (row) =>
              row.status === "open"
                ? (
                  <Button size="sm" variant="primary" disabled={!hydrated} onClick={() => props.onPay(row.id)}>
                    Record payment
                  </Button>
                )
                : null
          }
        ]}
      />
    </PageSection>
  )
}
