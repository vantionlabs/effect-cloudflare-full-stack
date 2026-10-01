/**
 * A tool result rendered as data: nested objects as label/value rows, arrays of objects as a table of rows.
 *
 * Generic on purpose — the tools' results are whatever the tools return, and showing them verbatim is the point:
 * the data is the authority, the answer is a convenience. Field names stay the tools' own (only underscores become
 * spaces): translating them would make the table disagree with what the model was given.
 *
 * Responsive by structure: an object's rows are a definition list that sits label-beside-value from `sm` up and
 * label-above-value below it, so nesting never squeezes a label into a one-word column on a phone; a table of rows
 * keeps every cell on one line and scrolls sideways instead of breaking a date in two.
 */
const label = (key: string) => key.replaceAll("_", " ")

export function DataValue(props: { readonly value: unknown }) {
  const { value } = props
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-ink-3">geen</span>
    if (typeof value[0] !== "object" || value[0] === null) return <span>{value.join(", ")}</span>
    const columns = Object.keys(value[0] as object)
    return (
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full text-[12.5px]">
          <thead className="text-left text-ink-2">
            <tr>
              {columns.map((column) => (
                <th key={column} scope="col" className="py-1 pr-4 font-medium whitespace-nowrap">{label(column)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {value.map((row, index) => (
              <tr key={index} className="border-t border-line-soft">
                {columns.map((column) => (
                  <td key={column} className="tabular py-1 pr-4 whitespace-nowrap text-ink">
                    {String((row as Record<string, unknown>)[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  if (typeof value === "object" && value !== null) {
    return (
      <dl className="flex flex-col text-[12.5px]">
        {Object.entries(value).map(([key, inner]) => (
          <div
            key={key}
            className="grid gap-x-4 gap-y-0.5 border-t border-line-soft py-1.5 first:border-t-0 sm:grid-cols-[minmax(9rem,14rem)_1fr]"
          >
            <dt className="text-ink-2">{label(key)}</dt>
            <dd className="tabular min-w-0 text-ink">
              <DataValue value={inner} />
            </dd>
          </div>
        ))}
      </dl>
    )
  }
  return <span>{String(value)}</span>
}
