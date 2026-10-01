/**
 * A tool result rendered as tables: nested objects as key/value rows, arrays of objects as a table of rows.
 *
 * Generic on purpose — the tools' results are whatever the tools return, and showing them verbatim is the point:
 * the data is the authority, the answer is a convenience.
 */
const label = (key: string) => key.replaceAll("_", " ")

export function DataValue(props: { readonly value: unknown }) {
  const { value } = props
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-ink-3">none</span>
    if (typeof value[0] !== "object" || value[0] === null) return <span>{value.join(", ")}</span>
    const columns = Object.keys(value[0] as object)
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="text-left text-ink-2">
            <tr>
              {columns.map((column) => <th key={column} className="py-1 pr-3 font-medium">{label(column)}</th>)}
            </tr>
          </thead>
          <tbody>
            {value.map((row, index) => (
              <tr key={index} className="border-t border-line-soft">
                {columns.map((column) => (
                  <td key={column} className="tabular py-1 pr-3">
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
      <table className="w-full text-[13px]">
        <tbody>
          {Object.entries(value).map(([key, inner]) => (
            <tr key={key} className="border-t border-line-soft align-top first:border-t-0">
              <td className="w-1/3 py-1 pr-3 text-ink-2">{label(key)}</td>
              <td className="tabular py-1">
                <DataValue value={inner} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }
  return <span>{String(value)}</span>
}
