/** One proposed price-list change, shown as before → after for the fields it changes, with Apply and Reject. */
import { Button } from "@/components/atoms/Button"
import { formatEuro } from "@/lib/format"
import type { ProposedChange } from "@ea/modules/sales/domain/Change"

const FIELDS = [["name", "name"], ["unitPrice", "price"], ["vat", "vat"], ["active", "active"]] as const
type Kind = typeof FIELDS[number][1]

const show = (kind: Kind, value: unknown) =>
  kind === "price" ? formatEuro(Number(value)) : kind === "vat" ? `${Number(value) / 10}%` : String(value)

export function ProposalCard(props: {
  readonly change: ProposedChange
  readonly disabled: boolean
  readonly onApply: () => void
  readonly onReject: () => void
}) {
  const { change } = props
  const changed = FIELDS.filter(([key]) => change.before === null || change.before[key] !== change.after[key])
  return (
    <div className="flex flex-col gap-2 rounded-card bg-surface p-3 shadow-card" data-testid="proposal">
      <div className="text-sm font-semibold text-ink">
        {change.kind === "create_product" ? "New product" : "Change"}{" "}
        <span className="font-mono text-[12px]">{change.sku}</span>
      </div>
      <table className="w-full text-[13px]">
        <tbody>
          {changed.map(([key, kind]) => (
            <tr key={key}>
              <td className="w-24 py-0.5 text-ink-2">{kind}</td>
              <td className="tabular py-0.5">
                {change.before === null ?
                  null :
                  <span className="text-ink-3 line-through">{show(kind, change.before[key])}</span>}
                {change.before === null ? null : <span className="px-1.5 text-ink-3">→</span>}
                <span className="font-medium text-ink">{show(kind, change.after[key])}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2">
        <Button variant="primary" size="sm" disabled={props.disabled} onClick={props.onApply}>Apply</Button>
        <Button variant="secondary" size="sm" disabled={props.disabled} onClick={props.onReject}>Reject</Button>
      </div>
    </div>
  )
}
