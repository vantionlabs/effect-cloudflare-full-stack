"use client"

/* ─────────────────────────────────────────────────────────
 * ALLOCATION CARD — a total, split into its parts: one segmented bar, a legend, and the selected part's detail.
 *
 * LOCAL CHANGE (effect-ai): extracted from the registry's InsightCards (`@beautifui/insight-cards`), which bundles
 * three cards in an autoplaying carousel with demo content ("Vanilla 72.5%", "$51,785") and pulls in `liveline` for
 * the two chart cards. Only the allocation card is kept, and it is rebuilt around real data:
 *
 * - segments carry a raw `value`; every share is COMPUTED here from those values — no percentage is passed in, so
 *   none can disagree with the figures it describes;
 * - no demo default, no carousel, no autoplay, no liveline dependency;
 * - colours come from a fixed palette in order, and a share too small to see still gets a sliver, labelled exactly;
 * - the bar and the legend are one radio-like group: selecting a part is announced, and the arrow keys move it.
 * See components/BEAUTIFUL-UI-LICENSE.
 * ───────────────────────────────────────────────────────── */

import { type KeyboardEvent, type ReactNode, useState } from "react"

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)"

export type AllocationSegment = {
  readonly key: string
  readonly label: string
  /** The raw quantity, in any unit — shares are computed from these. */
  readonly value: number
  /** The quantity as a person reads it: "€ 1.250,00", "12.400 tokens". */
  readonly display: string
  /** One sentence about this part, shown when it is selected. */
  readonly detail?: ReactNode | undefined
}

const PALETTE = [
  { bar: "bg-accent", dot: "bg-accent", text: "text-accent-ink" },
  { bar: "bg-orange", dot: "bg-orange", text: "text-orange" },
  { bar: "bg-green", dot: "bg-green", text: "text-green" },
  { bar: "bg-ink-3", dot: "bg-ink-3", text: "text-ink-2" },
  { bar: "bg-line-strong", dot: "bg-line-strong", text: "text-ink-2" }
] as const

const PERCENT = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1 })

/** Colours in order; parts past the palette share its last, quietest tone. */
const tone = (index: number) => PALETTE[Math.min(index, PALETTE.length - 1)]!

export default function AllocationCard({
  title,
  total,
  segments,
  className = ""
}: {
  /** What is being divided: "Tokens per model", "Uitgaven komende 12 weken". */
  title: string
  /** The whole, as a person reads it. */
  total: string
  segments: ReadonlyArray<AllocationSegment>
  className?: string | undefined
}) {
  const [selected, setSelected] = useState(0)
  const sum = segments.reduce((acc, segment) => acc + Math.max(segment.value, 0), 0)
  const share = (segment: AllocationSegment) => (sum === 0 ? 0 : (Math.max(segment.value, 0) / sum) * 100)
  const current = Math.min(selected, Math.max(segments.length - 1, 0))
  const active = segments[current]

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return
    event.preventDefault()
    const step = event.key === "ArrowRight" ? 1 : -1
    setSelected((current + step + segments.length) % segments.length)
  }

  return (
    <div className={`rounded-card bg-surface p-4 shadow-card ${className}`}>
      <span className="block text-[12px] font-medium text-ink-2">{title}</span>
      {/* The headline is the WHOLE. The selected part sits under it, so a part's amount is never read as the total. */}
      <span className="tabular mt-1 block text-[20px] font-semibold tracking-[-0.01em] text-ink">{total}</span>
      <span className="tabular block text-[12px] text-ink-3" aria-live="polite">
        {active === undefined ? "" : `${active.label}: ${active.display} · ${PERCENT.format(share(active))}%`}
      </span>

      <div
        className="mt-3 flex h-8 gap-0.5 overflow-hidden rounded-full bg-field p-0.5"
        role="radiogroup"
        aria-label={title}
        onKeyDown={onKeyDown}
      >
        {segments.map((segment, index) => {
          const isSelected = index === current
          return (
            <button
              key={segment.key}
              type="button"
              role="radio"
              aria-checked={isSelected}
              tabIndex={isSelected ? 0 : -1}
              aria-label={`${segment.label}: ${segment.display}, ${PERCENT.format(share(segment))}%`}
              onClick={() => setSelected(index)}
              className={`relative h-full overflow-hidden rounded-full ${
                tone(index).bar
              } transition-[opacity,transform] duration-300 active:scale-[0.98]`}
              style={{
                width: `${share(segment)}%`,
                minWidth: 6,
                opacity: isSelected ? 1 : 0.55,
                transitionTimingFunction: EASE
              }}
            >
              <span
                aria-hidden
                className="absolute inset-y-1 left-1 rounded-full bg-white/20 transition-[width,opacity] duration-500"
                style={{
                  width: isSelected ? "calc(100% - 8px)" : "0%",
                  opacity: isSelected ? 1 : 0,
                  transitionTimingFunction: EASE
                }}
              />
            </button>
          )
        })}
      </div>

      <ul className="mt-2 flex flex-wrap items-center gap-1.5" aria-hidden>
        {segments.map((segment, index) => (
          <li key={segment.key}>
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setSelected(index)}
              className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] transition-[background-color,color,transform] duration-150 active:scale-[0.96] ${
                index === current ? "bg-field text-ink" : "text-ink-2 hover:bg-hover hover:text-ink"
              }`}
            >
              <span className={`size-1.5 rounded-full ${tone(index).dot}`} />
              {segment.label} <span className="tabular">{PERCENT.format(share(segment))}%</span>
            </button>
          </li>
        ))}
      </ul>

      {active?.detail === undefined ?
        null :
        (
          <div className="mt-3 rounded-control bg-inset px-2.5 py-2 text-[12px] text-ink-2 shadow-hairline">
            <span className={`block font-medium ${tone(current).text}`}>{active.label}</span>
            <span className="mt-0.5 block">{active.detail}</span>
          </div>
        )}
    </div>
  )
}
