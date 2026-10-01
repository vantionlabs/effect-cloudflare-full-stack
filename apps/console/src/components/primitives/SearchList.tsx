"use client"

/* ─────────────────────────────────────────────────────────
 * SEARCH — command search with live filtering.
 * The field, clear action, and results are directly usable.
 *
 * LOCAL CHANGE (effect-ai): the registry version filtered a hard-coded list of demo strings ("Forecast summer
 * demand", "Find waffle cone suppliers", …) and could only be driven by the mouse. This copy keeps its look — the
 * raised card, the hairline input row, the glide highlight, the empty state — and becomes a real combobox:
 *
 * - items are passed in (`SearchItem`, grouped), never defaulted, so nothing invented can appear;
 * - the keyboard drives it (↑/↓ move, Enter chooses, Home/End jump), with `aria-activedescendant` so a screen reader
 *   follows the active option while focus stays in the field;
 * - `loading` shows skeleton rows in the shape of results instead of an empty list;
 * - copy comes from `labels`, in Dutch by default.
 * See components/BEAUTIFUL-UI-LICENSE.
 * ───────────────────────────────────────────────────────── */

import GlideMenu from "@/components/primitives/GlideMenu"
import { type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react"

export type SearchItem = {
  readonly id: string
  readonly label: string
  /** A second, quieter line: a status, a SKU, a date. */
  readonly detail?: string | undefined
  /** The heading the item is listed under. Groups keep the order of their first item. */
  readonly group: string
  /** Extra text matched by the filter but not shown. */
  readonly keywords?: string | undefined
  readonly icon?: ReactNode | undefined
}

export type SearchListLabels = {
  placeholder: string
  ariaLabel: string
  emptyTitle: string
  emptyHint: string
  loading: string
}

const LABELS: SearchListLabels = {
  placeholder: "Zoek een pagina, offerte, product of document…",
  ariaLabel: "Zoeken",
  emptyTitle: "Niets gevonden",
  emptyHint: "Probeer een ander woord, een artikelnummer of een klantnaam.",
  loading: "Gegevens worden geladen"
}

/** Shown per group before the person types; while typing, a group shows this many matches. */
const PER_GROUP = 6

const matches = (item: SearchItem, query: string) =>
  `${item.label} ${item.detail ?? ""} ${item.keywords ?? ""}`.toLowerCase().includes(query)

export default function SearchList({
  items,
  labels = LABELS,
  loading = false,
  onSelect,
  onEscape,
  emptyQueryGroups,
  className = ""
}: {
  items: ReadonlyArray<SearchItem>
  labels?: SearchListLabels | undefined
  /** Records still loading: skeleton rows appear under the items that are already there. */
  loading?: boolean | undefined
  onSelect: (item: SearchItem) => void
  onEscape?: (() => void) | undefined
  /** Which groups to show before anything is typed (all of them when absent). */
  emptyQueryGroups?: ReadonlyArray<string> | undefined
  className?: string | undefined
}) {
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const listId = useId()
  const list = useRef<HTMLDivElement>(null)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const pool = q === ""
      ? items.filter((item) => emptyQueryGroups === undefined || emptyQueryGroups.includes(item.group))
      : items.filter((item) => matches(item, q))
    const counts = new Map<string, number>()
    return pool.filter((item) => {
      const n = counts.get(item.group) ?? 0
      counts.set(item.group, n + 1)
      return n < PER_GROUP
    })
  }, [items, query, emptyQueryGroups])

  // A new query starts at the top; a shrinking list never leaves the active row past its end.
  useEffect(() => setActive(0), [query])
  const current = Math.min(active, Math.max(results.length - 1, 0))

  useEffect(() => {
    list.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" })
  }, [current])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      if (results.length === 0) return
      const step = event.key === "ArrowDown" ? 1 : -1
      setActive((current + step + results.length) % results.length)
    } else if (event.key === "Home" && results.length > 0) {
      event.preventDefault()
      setActive(0)
    } else if (event.key === "End" && results.length > 0) {
      event.preventDefault()
      setActive(results.length - 1)
    } else if (event.key === "Enter") {
      event.preventDefault()
      const chosen = results[current]
      if (chosen !== undefined) onSelect(chosen)
    } else if (event.key === "Escape" && onEscape !== undefined) {
      event.preventDefault()
      onEscape()
    }
  }

  const empty = !loading && results.length === 0
  const groups: Array<
    { readonly name: string; readonly rows: Array<{ readonly item: SearchItem; readonly index: number }> }
  > = []
  results.forEach((item, index) => {
    const group = groups.find((g) => g.name === item.group)
    if (group === undefined) groups.push({ name: item.group, rows: [{ item, index }] })
    else group.rows.push({ item, index })
  })
  const optionId = (index: number) => `${listId}-option-${index}`

  return (
    <div className={`flex w-full flex-col items-stretch ${className}`}>
      <div className="w-full overflow-hidden rounded-card bg-surface shadow-raised">
        {/* input row */}
        <div className="flex h-11 items-center gap-2 border-b border-line px-3">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--ink-3)"
            strokeWidth="2"
            strokeLinecap="round"
            className="shrink-0"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={labels.placeholder}
            aria-label={labels.ariaLabel}
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={results.length > 0 ? optionId(current) : undefined}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3"
          />
          {query && (
            <button
              aria-label="Zoekopdracht wissen"
              type="button"
              onClick={() => setQuery("")}
              className="flex size-6 items-center justify-center rounded-full text-ink-3
                transition-colors duration-100 hover:bg-line/70 hover:text-ink"
              style={{ animation: "fade-in 150ms ease-out both" }}
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* results / empty state */}
        <div
          ref={list}
          id={listId}
          role="listbox"
          aria-label={labels.ariaLabel}
          className="max-h-[min(60vh,420px)] overflow-y-auto p-1"
        >
          {empty ?
            (
              <div
                className="flex flex-col items-center justify-center gap-1 px-4 py-8 text-center"
                style={{ animation: "fade-in 250ms ease-out both" }}
              >
                <span className="text-[13px] font-medium text-ink">{labels.emptyTitle}</span>
                <span className="text-[12px] text-ink-3">{labels.emptyHint}</span>
              </div>
            ) :
            (
              <GlideMenu className="flex flex-col" highlightClassName="inset-x-0 rounded-[6px] bg-hover">
                {groups.map((group) => (
                  <div key={group.name} role="group" aria-label={group.name} className="flex flex-col gap-px pb-1">
                    <span aria-hidden className="px-2 pt-2 pb-1 text-[11px] font-medium text-ink-3">{group.name}</span>
                    {group.rows.map(({ item, index }) => {
                      const isActive = index === current
                      return (
                        <div
                          key={item.id}
                          id={optionId(index)}
                          role="option"
                          aria-selected={isActive}
                          data-index={index}
                          data-menu-row
                          onMouseMove={() => setActive(index)}
                          onClick={() =>
                            onSelect(item)}
                          className={`relative z-10 flex min-h-8 cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1 text-[13px] text-ink ${
                            isActive ? "bg-hover-2" : ""
                          }`}
                        >
                          {item.icon === undefined ? null : <span className="shrink-0 text-ink-3">{item.icon}</span>}
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                          {item.detail === undefined ?
                            null :
                            <span className="shrink-0 truncate text-[12px] text-ink-3">{item.detail}</span>}
                        </div>
                      )
                    })}
                  </div>
                ))}
                {loading ?
                  (
                    <div role="status" aria-label={labels.loading} className="flex flex-col gap-1.5 px-2 py-2">
                      {[0, 1, 2].map((row) => (
                        <span
                          key={row}
                          aria-hidden
                          className="block h-4 rounded-[6px] bg-hover-2"
                          style={{
                            width: `${70 - row * 15}%`,
                            backgroundImage:
                              "linear-gradient(90deg, transparent 0%, var(--hover) 50%, transparent 100%)",
                            backgroundSize: "200% 100%",
                            animation: "shimmer-text 1.6s linear infinite"
                          }}
                        />
                      ))}
                    </div>
                  ) :
                  null}
              </GlideMenu>
            )}
        </div>
      </div>
    </div>
  )
}
