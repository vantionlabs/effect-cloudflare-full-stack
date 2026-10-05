/** Tokens by model: platform cost, not billed directly. A 70B call and a small one differ by an order of magnitude. */
import { DataTable } from "@/components/data/data-table"
import { PageSection } from "@/components/layout/page"
import { RollingDigits } from "@/components/motion/rolling-digits"
import AllocationCard from "@/components/primitives/AllocationCard"
import { formatCount } from "@/lib/format"
import type { ModelTokens as Row } from "../usage-figures.ts"

export function ModelTokens(props: { readonly models: ReadonlyArray<Row> }) {
  return (
    <PageSection
      id="tokens"
      title="Tokens per model"
      description="Wat het platform aan AI-modellen besteedt. Wordt niet direct gefactureerd."
    >
      {
        /*
         * The share of all tokens per model — computed from the same rows as the table below. Only with two or more
         * models: a single full bar says nothing the table does not.
         */
        props.models.length < 2 ? null : (
          <AllocationCard
            title="Aandeel per model (invoer + uitvoer)"
            total={`${formatCount(totalTokens(props.models))} tokens`}
            segments={props.models.map((row) => ({
              key: row.model,
              label: row.model.split("/").at(-1) ?? row.model,
              value: row.input + row.output,
              display: `${formatCount(row.input + row.output)} tokens`,
              detail: (
                <>
                  <span className="font-mono">{row.model}</span>: {formatCount(row.input)} invoer,{" "}
                  {formatCount(row.output)} uitvoer.
                </>
              )
            }))}
          />
        )
      }
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

const totalTokens = (models: ReadonlyArray<Row>) => models.reduce((sum, row) => sum + row.input + row.output, 0)
