/**
 * The frame every sign-in page sits in: one centred card on the page background, with a title, a line saying what
 * the page is for, the form, and the links to the neighbouring pages underneath.
 */
import type { ReactNode } from "react"

export function AuthCard(props: {
  readonly title: string
  readonly description?: ReactNode
  readonly children: ReactNode
  readonly footer?: ReactNode
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-page px-4 py-12">
      <div className="flex w-full max-w-sm flex-col gap-5 rounded-card bg-surface p-6 shadow-card">
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-medium tracking-wide text-ink-3 uppercase">effect-ai</span>
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
