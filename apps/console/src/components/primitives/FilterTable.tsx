/**
 * FILTER TABLE — status chips that filter the rows below them, each chip carrying how many rows it would show.
 *
 * Adapted from Beautiful UI's `filter-table` (MIT, © 2026 Shane Levine — see components/BEAUTIFUL-UI-LICENSE): the chip
 * row is kept as it was — pill chips, a status dot, a count, the active chip lifted onto the surface.
 *
 * LOCAL CHANGE (effect-ai): the registry version hard-coded its rows (ice-cream tasks) AND its counts (5/2/2/1), so
 * the numbers on the chips were claims nobody computed. Here the caller passes the rows and how to read a row's
 * status; every count is computed from those rows; and the table itself is a render prop, so the console's own
 * `DataTable` draws the rows and keeps its accessible caption.
 */
import { type ReactNode, useState } from "react"

export interface FilterOption<Key extends string> {
  readonly key: Key
  readonly label: string
  /** A CSS colour for the chip's dot, e.g. `var(--orange)`. */
  readonly dot?: string | undefined
}

export default function FilterTable<Row, Key extends string>(props: {
  readonly rows: ReadonlyArray<Row>
  readonly statusOf: (row: Row) => Key
  readonly filters: ReadonlyArray<FilterOption<Key>>
  readonly allLabel: string
  /** Names the chip group for assistive technology, e.g. "Offertes filteren". */
  readonly label: string
  readonly children: (rows: ReadonlyArray<Row>) => ReactNode
}) {
  const [filter, setFilter] = useState<Key | "all">("all")
  const count = (key: Key) => props.rows.filter((row) => props.statusOf(row) === key).length
  // A chip whose filter would show nothing is hidden, unless it is the active one (so the person can leave it).
  const options = props.filters.filter((option) => count(option.key) > 0 || option.key === filter)
  const shown = filter === "all" ? props.rows : props.rows.filter((row) => props.statusOf(row) === filter)

  const chip = (key: Key | "all", label: string, total: number, dot?: string) => {
    const active = filter === key
    return (
      <button
        key={key}
        type="button"
        aria-pressed={active}
        onClick={() => setFilter(key)}
        className={`flex h-6.5 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium transition-[background-color,box-shadow,color,transform] duration-200 active:scale-[0.96] ${
          active ? "bg-surface text-ink shadow-btn" : "text-ink-2 hover:bg-hover"
        }`}
      >
        {dot === undefined ? null : <span aria-hidden className="size-1.5 rounded-full" style={{ background: dot }} />}
        {label}
        <span className={`tabular rounded-[4px] px-1 text-[10.5px] ${active ? "bg-field text-ink-2" : "text-ink-3"}`}>
          {total}
        </span>
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Only worth showing when there is something to tell apart. */}
      {options.length > 1 || filter !== "all"
        ? (
          <div
            role="group"
            aria-label={props.label}
            className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 py-1"
            style={{ scrollbarWidth: "none" }}
          >
            {chip("all", props.allLabel, props.rows.length)}
            {options.map((option) => chip(option.key, option.label, count(option.key), option.dot))}
          </div>
        )
        : null}
      {props.children(shown)}
    </div>
  )
}
