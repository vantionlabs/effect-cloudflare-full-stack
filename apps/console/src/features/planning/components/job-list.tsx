/** Opdrachten from accepted quotes, with the one next step each can take: mark done, then invoice. */
import { Button } from "@/components/atoms/Button"
import { DataTable } from "@/components/data/data-table"
import { StatusPill, type StatusTone } from "@/components/data/status-pill"
import { PageSection } from "@/components/layout/page"
import FilterTable from "@/components/primitives/FilterTable"
import { useHydrated } from "@/hooks/use-hydrated"
import { formatEuro } from "@/lib/format"
import type { Job } from "@ea/modules/sales/domain/Work"

const TONE: Record<Job["status"], StatusTone> = { open: "accent", done: "orange", invoiced: "green" }
const LABEL: Record<Job["status"], string> = { open: "bezig", done: "klaar", invoiced: "gefactureerd" }
const FILTERS = [
  { key: "open", label: "Bezig", dot: "var(--accent)" },
  { key: "done", label: "Klaar", dot: "var(--orange)" },
  { key: "invoiced", label: "Gefactureerd", dot: "var(--green)" }
] as const

export function JobList(props: {
  readonly jobs: ReadonlyArray<Job>
  readonly onComplete: (jobId: string) => void
  readonly onInvoice: (jobId: string) => void
}) {
  const hydrated = useHydrated()
  return (
    <PageSection id="jobs" title="Opdrachten" description="Ontstaan zodra een klant een offerte accepteert.">
      <FilterTable
        rows={props.jobs}
        statusOf={(job) => job.status}
        filters={FILTERS}
        allLabel="Alle"
        label="Opdrachten filteren op status"
      >
        {(shown) => (
          <DataTable<Job>
            caption="Opdrachten"
            rows={shown}
            rowKey={(job) => job.id}
            rowTestId="job"
            empty="Nog geen opdrachten. Markeer op Verkoop een verstuurde offerte als ‘Klant akkoord’; dan verschijnt hier de opdracht."
            columns={[
              { key: "customer", header: "Klant", cell: (job) => job.customerName ?? "Onbekende klant" },
              {
                key: "value",
                header: "Waarde",
                align: "right",
                cell: (job) => <span className="whitespace-nowrap">{formatEuro(job.value)}</span>
              },
              {
                key: "status",
                header: "Status",
                cell: (job) => <StatusPill tone={TONE[job.status]} testId="job-status">{LABEL[job.status]}</StatusPill>
              },
              {
                key: "action",
                header: <span className="sr-only">Actie</span>,
                align: "right",
                cell: (job) =>
                  job.status === "open"
                    ? (
                      <Button size="sm" variant="primary" disabled={!hydrated} onClick={() => props.onComplete(job.id)}>
                        Klaar melden
                      </Button>
                    )
                    : job.status === "done"
                    ? (
                      <Button size="sm" variant="primary" disabled={!hydrated} onClick={() => props.onInvoice(job.id)}>
                        Factureren
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
