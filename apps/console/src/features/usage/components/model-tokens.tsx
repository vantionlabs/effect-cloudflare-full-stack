/** Tokens by model: platform cost, not billed directly. A 70B call and a small one differ by an order of magnitude. */
import { DataTable } from "@/components/data/data-table"
import { PageSection } from "@/components/layout/page"
import { formatCount } from "@/lib/format"
import type { ModelTokens as Row } from "../usage-figures.ts"

export function ModelTokens(props: { readonly models: ReadonlyArray<Row> }) {
  return (
    <PageSection id="tokens" title="Model tokens" description="Platform cost, by model. Not billed directly.">
      <DataTable<Row>
        caption="Model tokens"
        rows={props.models}
        rowKey={(row) => row.model}
        empty="No model calls this period."
        columns={[
          { key: "model", header: "Model", cell: (row) => <span className="font-mono text-[12px]">{row.model}</span> },
          { key: "input", header: "Input", align: "right", cell: (row) => formatCount(row.input) },
          { key: "output", header: "Output", align: "right", cell: (row) => formatCount(row.output) }
        ]}
      />
    </PageSection>
  )
}
