"use client"

/* ─────────────────────────────────────────────────────────
 * CONTEXT CARDS
 * Retrieved chunks enter once, then remain available.
 * ───────────────────────────────────────────────────────── */

export type ContextChunk = {
  title: string
  chars: string
  body: string
  source: string
  badge: string
  tone: string
}

export type ContextCardsLabels = {
  header: string
  count: string
}

// LOCAL CHANGE (effect-ai): no default count — a number nobody computed is an invented claim. Callers pass both.
const DEFAULT_LABELS: ContextCardsLabels = {
  header: "Bronnen",
  count: ""
}

// LOCAL CHANGE (effect-ai): the registry's demo chunks are removed; `chunks` is required.

export default function ContextCards({
  chunks,
  labels,
  className
}: {
  /** Accepted for gallery/registry parity; ContextCards has no visual variants. */
  variant?: string | undefined
  chunks: ContextChunk[]
  labels?: Partial<ContextCardsLabels> | undefined
  className?: string | undefined
}) {
  const copy = { ...DEFAULT_LABELS, ...labels }

  /*
   * LOCAL CHANGE (effect-ai): full width rather than `max-w-95`, so a passage reads at the page's measure; the source
   * chips pop in by CSS animation delay rather than a 700ms `setTimeout` + state, so nothing waits on JavaScript.
   */
  return (
    <div className={`flex w-full flex-col gap-2${className ? ` ${className}` : ""}`}>
      <div
        className="flex items-center gap-2 px-0.5"
        style={{ animation: "fade-in 400ms ease-out both" }}
      >
        <span className="text-[13px] font-semibold text-ink">{copy.header}</span>
        <span className="inline-flex h-5 items-center rounded-md bg-inset px-1.5 text-[11.5px] font-medium text-ink-2 shadow-hairline tabular-nums">
          {copy.count}
        </span>
      </div>

      {chunks.map((chunk, i) => (
        <div
          key={chunk.title}
          className="overflow-hidden rounded-card bg-surface shadow-card"
          style={{
            animation: `fade-up 400ms cubic-bezier(0.23,1,0.32,1) ${i * 100}ms both`
          }}
        >
          <div className="primitive-card-bar flex items-center gap-2.5 border-b border-line">
            <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-ink">
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <path d="M4 6h16M4 12h16M4 18h10" />
              </svg>
              <span className="truncate">{chunk.title}</span>
            </span>
            <span className="ml-auto shrink-0 text-[12px] text-ink-3 tabular-nums">{chunk.chars}</span>
          </div>
          <p className="px-3 pt-2 pb-1 text-[12.5px] leading-relaxed text-ink-2">
            {chunk.body}
          </p>
          <div className="px-3 pb-3">
            <span
              className="inline-flex h-6 items-center gap-1.5 rounded-full bg-inset px-2
                text-[12px] font-medium text-ink-2 shadow-btn"
              style={{ animation: `pop-in 250ms cubic-bezier(0.23,1,0.32,1) ${300 + i * 80}ms both` }}
            >
              <span
                className={`flex size-3.5 items-center justify-center rounded-[4px] ${chunk.tone} text-[7px] font-bold text-white`}
              >
                {chunk.badge}
              </span>
              {chunk.source}
              {/* LOCAL CHANGE (effect-ai): no "open" arrow — the chip names the source, it is not a link. */}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
