/* ─────────────────────────────────────────────────────────
 * TOOL CHIPS — from Beautiful UI (MIT, © 2026 Shane Levine; see components/BEAUTIFUL-UI-LICENSE)
 * An agent run as compact rows: one row per tool call, a chip saying what it was called with, and a detail panel
 * per row that expands to show exactly what the tool returned.
 *
 * LOCAL CHANGE (effect-ai): rewired for real data. Removed from the registry version:
 * - the demo rows, file diffs and diff previews (module-level constants and the portal);
 * - the 700ms step timer that revealed rows one by one — that presented finished work as if it were happening live;
 * - the default header ("4 tool calls, 2 messages") — a number nobody computed.
 * `steps` and `header` are required. Rows arrive with a short capped stagger, which is honest because they are in
 * the order the calls were made; `detail` is any node, so a row can carry a table rather than lines of text.
 * ───────────────────────────────────────────────────────── */
import { type ReactNode, useState } from "react"

export type ToolStep = {
  /** Stable key: the call's position in the run. */
  key: string
  icon: ReactNode
  label: string
  chip: string
  mono?: boolean | undefined
  detail: ReactNode
  /** Rows start open when what they returned is the point (Insights' data is the authority). */
  defaultOpen?: boolean | undefined
  testId?: string | undefined
}

export default function ToolChips({
  steps,
  header,
  className,
  onToggleRow
}: {
  steps: ReadonlyArray<ToolStep>
  header: string
  className?: string | undefined
  onToggleRow?: ((key: string, open: boolean) => void) | undefined
}) {
  const [open, setOpen] = useState(true)
  const [openRows, setOpenRows] = useState<ReadonlySet<string>>(
    () => new Set(steps.filter((step) => step.defaultOpen === true).map((step) => step.key))
  )

  const toggleRow = (key: string) =>
    setOpenRows((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      onToggleRow?.(key, next.has(key))
      return next
    })

  return (
    <div className={`w-full pb-1${className ? ` ${className}` : ""}`}>
      {/* collapsed run header */}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="-mx-1.5 flex w-fit items-center gap-1.5 rounded-control px-1.5 py-1 text-[12.5px] text-ink-2 transition-colors duration-100 hover:bg-hover-2"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="transition-transform duration-200"
          style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
        <span className="tabular-nums">{header}</span>
      </button>

      {/* tool call rows */}
      <div
        className="grid transition-[grid-template-rows,opacity] duration-300"
        style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }}
        inert={!open}
      >
        <div className="-mx-1 min-h-0 overflow-hidden px-1.5 pb-1">
          <div className="mt-1.5 flex flex-col gap-1">
            {steps.map((row, index) => {
              const rowOpen = openRows.has(row.key)
              return (
                <div
                  key={row.key}
                  data-testid={row.testId}
                  style={{
                    animation: `fade-up 300ms cubic-bezier(0.23,1,0.32,1) ${80 * Math.min(index, 4)}ms both`
                  }}
                >
                  <button
                    type="button"
                    aria-expanded={rowOpen}
                    onClick={() => toggleRow(row.key)}
                    className="group/row -mx-[3px] flex h-7 w-[calc(100%+6px)] min-w-0 items-center gap-2 rounded-control px-[3px] text-left transition-colors duration-100 hover:bg-hover-2"
                  >
                    <span className="relative flex size-4 shrink-0 items-center justify-center text-ink-3">
                      <span
                        className={`flex transition-opacity duration-100 group-hover/row:opacity-0 ${
                          rowOpen ? "opacity-0" : ""
                        }`}
                      >
                        {row.icon}
                      </span>
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                        className={`absolute transition-[opacity,transform] duration-150 group-hover/row:opacity-100 ${
                          rowOpen ? "opacity-100" : "opacity-0"
                        }`}
                        style={{ transform: rowOpen ? "rotate(0deg)" : "rotate(-90deg)" }}
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </span>
                    <span className="shrink-0 text-[12.5px] font-medium text-ink">{row.label}</span>
                    <span
                      className={`inline-flex h-5.5 min-w-0 flex-1 items-center truncate rounded-chip bg-field px-1.5 text-[11.5px] text-ink-2 shadow-hairline ${
                        row.mono === true ? "font-mono" : ""
                      }`}
                    >
                      {row.chip}
                    </span>
                  </button>

                  {/* expanded detail */}
                  <div
                    className="grid transition-[grid-template-rows,opacity] duration-300"
                    style={{
                      gridTemplateRows: rowOpen ? "1fr" : "0fr",
                      opacity: rowOpen ? 1 : 0,
                      transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)"
                    }}
                    inert={!rowOpen}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <div className="mt-0.5 mb-2 ml-2 border-l border-line py-1 pl-3.5">{row.detail}</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
