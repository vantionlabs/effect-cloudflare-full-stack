/**
 * DIFF TABLE — a proposed change, field by field: what it is now, and what it would become.
 *
 * Adapted from Beautiful UI's `diff-table` (MIT, © 2026 Shane Levine — see components/BEAUTIFUL-UI-LICENSE): its
 * look is kept — hairline table on a card, the old value struck through on a red tint, the new one on a green tint —
 * and everything that was a demo is gone.
 *
 * LOCAL CHANGE (effect-ai): the registry version played a scripted edit on timers (`useStage`), hard-coded its rows,
 * headers and an added "Pistachio" row, and showed "edits applied" when its own button was clicked, with no server
 * involved. Here the rows are the caller's, nothing advances on a clock, and the footer is whatever the caller puts
 * there — the real Apply and Reject, whose outcome comes from the server.
 */
import type { ReactNode } from "react"

export interface DiffRow {
  readonly key: string
  /** The field's name as a person reads it: "Prijs", "Btw". */
  readonly field: string
  /** `null` when the thing is new — there is no "before" to strike through. */
  readonly before: ReactNode | null
  readonly after: ReactNode
}

export default function DiffTable(props: {
  readonly title: ReactNode
  readonly rows: ReadonlyArray<DiffRow>
  readonly labels: { readonly field: string; readonly before: string; readonly after: string }
  readonly footer?: ReactNode | undefined
  readonly testId?: string | undefined
}) {
  return (
    <div data-testid={props.testId} className="overflow-hidden rounded-card bg-surface shadow-card">
      <div className="primitive-card-bar flex items-center justify-between gap-2 border-b border-line">
        <span className="text-[12.5px] font-medium text-ink">{props.title}</span>
      </div>
      <table className="w-full table-fixed border-collapse text-left">
        <colgroup>
          <col className="w-[28%]" />
          <col className="w-[36%]" />
          <col className="w-[36%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-line">
            {[props.labels.field, props.labels.before, props.labels.after].map((header) => (
              <th key={header} scope="col" className="primitive-table-cell text-[12px] font-medium text-ink-3">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr key={row.key} className="border-b border-line last:border-0">
              <th scope="row" className="primitive-table-cell text-[12.5px] font-normal text-ink-2">{row.field}</th>
              <td
                className="primitive-table-cell tabular text-[13px]"
                style={{ background: row.before === null ? undefined : "var(--red-tint)" }}
              >
                {row.before === null ? <span className="text-ink-3">—</span> : (
                  <span
                    className="text-red"
                    style={{
                      textDecorationLine: "line-through",
                      textDecorationColor: "color-mix(in srgb, var(--red) 50%, transparent)"
                    }}
                  >
                    {row.before}
                  </span>
                )}
              </td>
              <td
                className="primitive-table-cell tabular text-[13px] font-medium text-green"
                style={{ background: "var(--green-tint)" }}
              >
                {row.after}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {props.footer === undefined ?
        null :
        (
          <div className="primitive-card-footer flex min-h-11 items-center justify-between gap-2 border-t border-line">
            {props.footer}
          </div>
        )}
    </div>
  )
}
