/**
 * The frame every sign-in page sits in: the brand above one centred card on the page background, with a title, a
 * line saying what the page is for, the form, and the links to the neighbouring pages underneath.
 *
 * The brand is a lockup ABOVE the card — mark and name — not a small label over the heading: the heading carries the
 * page, the lockup carries the product. The card arrives with the one entrance the sign-in flow has, a short
 * `fade-up` that runs from CSS on first paint, so nothing waits for JavaScript to become visible.
 */
import { enter } from "@/lib/motion"
import { BarChart3 } from "lucide-react"
import type { ReactNode } from "react"

export function AuthCard(props: {
  readonly title: string
  readonly description?: ReactNode
  readonly children: ReactNode
  readonly footer?: ReactNode
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-page px-4 py-12">
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-control bg-ink text-canvas shadow-btn">
          <BarChart3 className="size-4.5" aria-hidden />
        </span>
        <span className="text-[17px] font-semibold tracking-tight text-ink">effect-ai</span>
      </div>
      <div className="flex w-full max-w-sm flex-col gap-5 rounded-card bg-surface p-6 shadow-card" style={enter(0)}>
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold tracking-tight text-ink">{props.title}</h1>
          {props.description === undefined ? null : <p className="text-sm text-ink-2">{props.description}</p>}
        </div>
        {props.children}
        {props.footer === undefined ? null : <div className="text-[13px] text-ink-2">{props.footer}</div>}
      </div>
    </main>
  )
}

/** A quiet link in an auth card's footer. */
export const authLinkClass = "text-ink-2 underline-offset-4 hover:text-ink hover:underline"
