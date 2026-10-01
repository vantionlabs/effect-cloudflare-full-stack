/** Tokens by model: platform cost, not billed directly. A 70B call and a small one differ by an order of magnitude. */
import { DataTable } from "@/components/data/data-table"
import { PageSection } from "@/components/layout/page"
import { RollingDigits } from "@/components/motion/rolling-digits"
import { formatCount } from "@/lib/format"
import type { ModelTokens as Row } from "../usage-figures.ts"

export function ModelTokens(props: { readonly models: ReadonlyArray<Row> }) {
  return (
    <PageSection
      id="tokens"
      title="Tokens per model"
      description="Wat het platform aan AI-modellen besteedt. Wordt niet direct gefactureerd."
    >
      <DataTable<Row>
        caption="Tokens per model"
        rows={props.models}
        rowKey={(row) => row.model}
        empty="Deze periode zijn er geen AI-modellen aangeroepen."
        columns={[
          { key: "model", header: "Model", cell: (row) => <span className="font-mono text-[12px]">{row.model}</span> },
          {
            key: "input",
            header: "Invoer",
            align: "right",
            cell: (row) => <RollingDigits value={formatCount(row.input)} />
          },
          {
            key: "output",
            header: "Uitvoer",
            align: "right",
            cell: (row) => <RollingDigits value={formatCount(row.output)} />
          }
        ]}
      />
    </PageSection>
  )
}
