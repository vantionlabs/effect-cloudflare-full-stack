/**
 * What a page shows while a CLIENT-side load is in flight: the shape of the content that is coming, shimmering in
 * the palette's own tones — never "Loading…" text, and never a spinner in the middle of content.
 *
 * Server-rendered pages arrive with their data and need none of this; skeletons are for what the browser fetches
 * after the page is there (a refetch, a second page of results, a panel opened on demand). The shapes match the
 * real components' sizes, so nothing jumps when the content lands.
 */
import { cn } from "@/lib/utils"

export function Skeleton(props: { readonly className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("block rounded-control bg-hover-2", props.className)}
      style={{
        backgroundImage: "linear-gradient(90deg, transparent 0%, var(--hover) 50%, transparent 100%)",
        backgroundSize: "200% 100%",
        animation: "shimmer-text 1.6s linear infinite"
      }}
    />
  )
}

/** A table-shaped placeholder: a header row and `rows` lines, inside the same card a `DataTable` uses. */
export function SkeletonTable(props: { readonly rows?: number; readonly columns?: number; readonly label: string }) {
  const rows = props.rows ?? 4
  const columns = props.columns ?? 4
  return (
    <div role="status" aria-label={props.label} className="overflow-hidden rounded-card bg-surface shadow-card">
      <div className="flex gap-6 border-b border-line px-3 py-2.5">
        {Array.from(
          { length: columns },
          (_, column) => <Skeleton key={column} className={cn("h-3", column === 0 ? "w-28" : "w-16")} />
        )}
      </div>
      {Array.from(
        { length: rows },
        (_, row) => (
          <div key={row} className="flex gap-6 border-b border-line-soft px-3 py-3 last:border-b-0">
            {Array.from(
              { length: columns },
              (_, column) => <Skeleton key={column} className={cn("h-3.5", column === 0 ? "w-40" : "w-20")} />
            )}
          </div>
        )
      )}
    </div>
  )
}

/** Placeholder lines for prose — an answer, a description. */
export function SkeletonText(props: { readonly lines?: number; readonly label: string }) {
  const lines = props.lines ?? 3
  return (
    <div role="status" aria-label={props.label} className="flex flex-col gap-2">
      {Array.from(
        { length: lines },
        (_, line) => <Skeleton key={line} className={cn("h-3.5", line === lines - 1 ? "w-2/3" : "w-full")} />
      )}
    </div>
  )
}

/** Placeholder stat tiles, matching a row of `Stat`s. */
export function SkeletonStats(props: { readonly count?: number; readonly label: string }) {
  return (
    <div role="status" aria-label={props.label} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from(
        { length: props.count ?? 4 },
        (_, index) => (
          <div key={index} className="flex flex-col gap-2 rounded-card bg-surface p-4 shadow-card">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-5 w-24" />
          </div>
        )
      )}
    </div>
  )
}
