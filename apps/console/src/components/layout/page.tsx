/**
 * The frame every page sits in: a header with the page's title, what it is for and its main actions, then sections.
 *
 * Pages compose these rather than writing their own wrappers, so spacing, widths and heading levels are the same
 * everywhere — and a page file reads as its content, not its layout.
 */
import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

export function Page(props: { readonly children: ReactNode; readonly width?: "default" | "narrow" | "wide" }) {
  const width = props.width === "narrow" ? "max-w-2xl" : props.width === "wide" ? "max-w-6xl" : "max-w-5xl"
  return <main className={cn("mx-auto flex w-full flex-col gap-8 px-4 py-8 md:px-8", width)}>{props.children}</main>
}

export function PageHeader(props: {
  readonly title: string
  readonly description?: ReactNode
  readonly actions?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex max-w-2xl flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-ink">{props.title}</h1>
        {props.description === undefined ? null : <p className="text-sm text-ink-2">{props.description}</p>}
      </div>
      {props.actions === undefined ? null : <div className="flex items-center gap-2">{props.actions}</div>}
    </header>
  )
}

/** A titled part of a page. `id` doubles as the heading's id, so `aria-labelledby` ties the section to it. */
export function PageSection(props: {
  readonly id: string
  readonly title: string
  readonly description?: ReactNode
  readonly actions?: ReactNode
  readonly children: ReactNode
}) {
  const headingId = `${props.id}-heading`
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id={headingId} className="text-[15px] font-semibold text-ink">{props.title}</h2>
          {props.description === undefined ? null : <p className="text-[13px] text-ink-2">{props.description}</p>}
        </div>
        {props.actions === undefined ? null : <div className="flex items-center gap-2">{props.actions}</div>}
      </div>
      {props.children}
    </section>
  )
}

/** A white card surface for content that is not a table or a stat: forms, answers, explanations. */
export function Panel(props: { readonly children: ReactNode; readonly className?: string }) {
  return <div className={cn("rounded-card bg-surface p-4 shadow-card", props.className)}>{props.children}</div>
}
