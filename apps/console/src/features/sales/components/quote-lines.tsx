/** A quote's lines and totals. Every amount is the price list's, computed in integer cents — not the model's. */
import { formatEuro, formatQuantity } from "@/lib/format"
import type { Quote } from "@ea/modules/sales/domain/Quote"

export function QuoteLines(props: { readonly quote: Quote }) {
  const { quote } = props
  return (
    <div className="flex flex-col gap-2">
      {quote.lines.length === 0 ? null : (
        <table className="w-full text-[13px]">
          <caption className="sr-only">Quote lines</caption>
          <tbody>
            {quote.lines.map((line) => (
              <tr key={`${quote.id}-${line.sku}-${line.requestText}`} className="border-t border-line-soft">
                <td className="tabular py-1.5 pr-3 whitespace-nowrap text-ink">
                  {formatQuantity(line.quantity)} {line.unit}
                </td>
                <td className="py-1.5 pr-3">
                  <span className="text-ink">{line.description}</span>{" "}
                  <span className="font-mono text-[12px] text-ink-3">({line.sku})</span>
                  <div className="text-[12px] text-ink-3">“{line.requestText}”</div>
                </td>
                <td className="tabular py-1.5 pr-3 text-right text-ink-2">{formatEuro(line.unitPrice)}</td>
                <td className="tabular py-1.5 text-right text-ink">{formatEuro(line.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <dl className="tabular ml-auto grid grid-cols-[auto_auto] gap-x-4 text-right text-[13px]">
        <dt className="text-ink-2">Subtotal</dt>
        <dd className="text-ink">{formatEuro(quote.subtotal)}</dd>
        <dt className="text-ink-2">VAT</dt>
        <dd className="text-ink">{formatEuro(quote.vatTotal)}</dd>
      </dl>
      <div className="tabular text-right text-sm font-semibold text-ink" data-testid="quote-total">
        Total {formatEuro(quote.total)}
      </div>
    </div>
  )
}
