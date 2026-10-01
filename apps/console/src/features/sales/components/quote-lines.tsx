/**
 * A quote's lines. Every amount is the price list's, computed in integer cents — not the model's. The customer's own
 * words for each line sit under it, so a person can check the model picked the right product.
 */
import { formatEuro, formatQuantity } from "@/lib/format"
import type { Quote } from "@ea/modules/sales/domain/Quote"
import { UNIT_LABEL } from "../units.ts"

export function QuoteLines(props: { readonly quote: Quote }) {
  const { quote } = props
  return (
    <table className="w-full text-[13px]">
      <caption className="sr-only">Offerteregels</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Aantal</th>
          <th scope="col">Product</th>
          <th scope="col">Prijs per eenheid</th>
          <th scope="col">Regeltotaal</th>
        </tr>
      </thead>
      <tbody>
        {quote.lines.map((line) => (
          <tr key={`${quote.id}-${line.sku}-${line.requestText}`} className="border-t border-line-soft">
            <td className="tabular py-1.5 pr-3 align-top whitespace-nowrap text-ink">
              {formatQuantity(line.quantity)} {UNIT_LABEL[line.unit as keyof typeof UNIT_LABEL] ?? line.unit}
            </td>
            <td className="py-1.5 pr-3">
              <span className="text-ink">{line.description}</span>{" "}
              <span className="font-mono text-[12px] text-ink-3">({line.sku})</span>
              <div className="text-[12px] text-ink-3">“{line.requestText}”</div>
            </td>
            <td className="tabular py-1.5 pr-3 text-right align-top whitespace-nowrap text-ink-2">
              {formatEuro(line.unitPrice)}
            </td>
            <td className="tabular py-1.5 text-right align-top whitespace-nowrap text-ink">
              {formatEuro(line.lineTotal)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
