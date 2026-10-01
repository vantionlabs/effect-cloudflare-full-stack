/**
 * The account page's own frame: the effect-ai lockup and the way back, with none of the workspace navigation —
 * this page is about the person, not the organization they are looking at.
 */
import { Link } from "@tanstack/react-router"
import { ArrowLeft, BarChart3 } from "lucide-react"
import type { ReactNode } from "react"

export function AccountFrame(props: { readonly children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-page">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 rounded-control">
            <span className="flex size-7 items-center justify-center rounded-control bg-ink text-canvas">
              <BarChart3 className="size-4" aria-hidden />
            </span>
            <span className="text-[14px] font-semibold text-ink">effect-ai</span>
          </Link>
          <Link
            to="/"
            className="flex items-center gap-1.5 rounded-control px-2 py-1 text-[13px] text-ink-2 transition-colors duration-100 hover:bg-hover hover:text-ink"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Terug naar het dashboard
          </Link>
        </div>
      </header>
      <main className="mx-auto flex max-w-2xl flex-col gap-10 px-4 py-8">{props.children}</main>
    </div>
  )
}

/** A titled block of the account page, the same rhythm as `PageSection` in the dashboard. */
export function AccountSection(props: {
  readonly id: string
  readonly title: string
  readonly description?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <section aria-labelledby={`${props.id}-heading`} className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 id={`${props.id}-heading`} className="text-[15px] font-semibold text-ink">{props.title}</h2>
        {props.description === undefined ? null : <p className="text-[13px] text-ink-2">{props.description}</p>}
      </div>
      {props.children}
    </section>
  )
}
