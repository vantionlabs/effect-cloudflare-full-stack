/**
 * A plain, typed table in Beautiful UI's style: hairline rows, quiet header, tabular figures right-aligned.
 *
 * Columns are data, not markup — `{ key, header, cell, align }` — so a page describes WHAT to show and every table
 * looks and behaves the same. Deliberately not the registry's `RecordsTable`, whose rows are a fixed CRM shape.
 */
import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

export interface Column<Row> {
  readonly key: string
  readonly header: ReactNode
  readonly cell: (row: Row) => ReactNode
  readonly align?: "left" | "right"
  readonly className?: string
}

export function DataTable<Row>(props: {
  readonly rows: ReadonlyArray<Row>
  readonly columns: ReadonlyArray<Column<Row>>
  readonly rowKey: (row: Row) => string
  readonly empty: ReactNode
  readonly caption?: string
  readonly rowTestId?: string
}) {
  if (props.rows.length === 0) return <EmptyRow>{props.empty}</EmptyRow>
  return (
    <div className="overflow-x-auto rounded-card bg-surface shadow-card">
      <table className="w-full border-collapse text-[13px]">
        {props.caption === undefined ? null : <caption className="sr-only">{props.caption}</caption>}
        <thead>
          <tr className="border-b border-line">
            {props.columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  "px-3 py-2 text-[12px] font-medium whitespace-nowrap text-ink-2",
                  column.align === "right" ? "text-right" : "text-left"
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr
              key={props.rowKey(row)}
              data-testid={props.rowTestId}
              className="border-b border-line-soft last:border-b-0 hover:bg-inset"
            >
              {props.columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    "px-3 py-2 align-middle text-ink",
                    column.align === "right" ? "tabular text-right whitespace-nowrap" : "text-left",
                    column.className
                  )}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EmptyRow(props: { readonly children: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-line-strong px-4 py-6 text-center text-[13px] text-ink-2">
      {props.children}
    </div>
  )
}
