/**
 * One proposed price-list change as a field diff — what it is now, what it would become — with Doorvoeren and
 * Afwijzen. Only the fields the change touches are listed; a new product has no "now".
 */
import { Button } from "@/components/atoms/Button"
import DiffTable, { type DiffRow } from "@/components/primitives/DiffTable"
import { formatEuro } from "@/lib/format"
import type { ProposedChange } from "@ea/modules/sales/domain/Change"

const FIELDS = [
  ["name", "Naam"],
  ["unitPrice", "Prijs"],
  ["vat", "Btw"],
  ["active", "In de prijslijst"]
] as const

const show = (key: typeof FIELDS[number][0], value: unknown) =>
  key === "unitPrice"
    ? formatEuro(Number(value))
    : key === "vat"
    ? `${Number(value) / 10}%`
    : key === "active"
    ? (value === true ? "ja" : "nee")
    : String(value)

export function ProposalCard(props: {
  readonly change: ProposedChange
  readonly disabled: boolean
  readonly onApply: () => void
  readonly onReject: () => void
}) {
  const { change } = props
  const rows: ReadonlyArray<DiffRow> = FIELDS
    .filter(([key]) => change.before === null || change.before[key] !== change.after[key])
    .map(([key, field]) => ({
      key,
      field,
      before: change.before === null ? null : show(key, change.before[key]),
      after: show(key, change.after[key])
    }))
  return (
    <DiffTable
      testId="proposal"
      title={
        <>
          {change.kind === "create_product" ? "Nieuw product" : "Wijziging"}{" "}
          <span className="font-mono text-[12px] text-ink-2">{change.sku}</span>
        </>
      }
      labels={{ field: "Veld", before: "Nu", after: "Wordt" }}
      rows={rows}
      footer={
        <>
          <span className="text-[11.5px] text-ink-3">Er verandert niets tot je dit doorvoert.</span>
          <span className="flex gap-1.5">
            <Button variant="secondary" size="sm" disabled={props.disabled} onClick={props.onReject}>Afwijzen</Button>
            <Button variant="primary" size="sm" disabled={props.disabled} onClick={props.onApply}>Doorvoeren</Button>
          </span>
        </>
      }
    />
  )
}
