/** Jobs from accepted quotes, with the one next step each can take: mark done, then invoice. */
import { Button } from "@/components/atoms/Button"
import { DataTable } from "@/components/data/data-table"
import { StatusPill, type StatusTone } from "@/components/data/status-pill"
import { PageSection } from "@/components/layout/page"
import { useHydrated } from "@/hooks/use-hydrated"
import { formatEuro } from "@/lib/format"
import type { Job } from "@ea/modules/sales/domain/Work"

const TONE: Record<Job["status"], StatusTone> = { open: "accent", done: "orange", invoiced: "green" }

export function JobList(props: {
  readonly jobs: ReadonlyArray<Job>
  readonly onComplete: (jobId: string) => void
  readonly onInvoice: (jobId: string) => void
}) {
  const hydrated = useHydrated()
  return (
    <PageSection id="jobs" title="Jobs" description="Created when a customer accepts a quote.">
      <DataTable<Job>
        caption="Jobs"
        rows={props.jobs}
        rowKey={(job) => job.id}
        rowTestId="job"
        empty="No jobs yet."
        columns={[
          { key: "customer", header: "Customer", cell: (job) => job.customerName ?? "Unknown customer" },
          { key: "value", header: "Value", align: "right", cell: (job) => formatEuro(job.value) },
          {
            key: "status",
            header: "Status",
            cell: (job) => (
              <span data-testid="job-status">
                <StatusPill tone={TONE[job.status]}>{job.status}</StatusPill>
              </span>
            )
          },
          {
            key: "action",
            header: <span className="sr-only">Action</span>,
            align: "right",
            cell: (job) =>
              job.status === "open"
                ? (
                  <Button size="sm" variant="primary" disabled={!hydrated} onClick={() => props.onComplete(job.id)}>
                    Mark done
                  </Button>
                )
                : job.status === "done"
                ? (
                  <Button size="sm" variant="primary" disabled={!hydrated} onClick={() => props.onInvoice(job.id)}>
                    Invoice
                  </Button>
                )
                : null
          }
        ]}
      />
    </PageSection>
  )
}
