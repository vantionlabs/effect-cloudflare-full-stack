/**
 * A conversation panel: a header, a scrolling thread and a composer — Beautiful UI's ChatComposer (MIT, see
 * components/BEAUTIFUL-UI-LICENSE), kept for its look and rebuilt as a CONTROLLED shell.
 *
 * LOCAL CHANGE (effect-ai): the registry version played a scripted exchange — demo "agent replies" revealed on
 * 500/1400/1200ms timers, demo tabs, and three header buttons labelled "Action" that did nothing. All of it is gone:
 * the thread is whatever the caller renders as `children`, the composer submits through `onSubmit`, and nothing
 * advances on a clock. The user bubble style is exported as `ChatQuestion` so callers draw questions the same way.
 */
import { type ReactNode, type RefObject, useRef } from "react"

export function ChatQuestion(props: { readonly children: ReactNode; readonly pending?: boolean | undefined }) {
  return (
    <div className="flex justify-end pl-10 sm:pl-14">
      <div
        className="rounded-xl bg-field px-3 py-1.5 text-[13px] leading-[1.45] whitespace-pre-wrap text-ink"
        style={{ opacity: props.pending === true ? 0.75 : 1, transition: "opacity 300ms cubic-bezier(0.23,1,0.32,1)" }}
      >
        {props.children}
      </div>
    </div>
  )
}

export default function ChatComposer(props: {
  readonly header?: ReactNode | undefined
  readonly children: ReactNode
  /** The scrolling region, for `useStickToBottom`. Its first child is the content the hook observes. */
  readonly scrollRef?: RefObject<HTMLDivElement | null> | undefined
  readonly value: string
  readonly onChange: (value: string) => void
  readonly onSubmit: (value: string) => void
  /** Disabled until hydration, and while a question is in flight. */
  readonly disabled: boolean
  readonly placeholder: string
  /** The composer's accessible name. */
  readonly inputLabel: string
  readonly submitLabel: string
  readonly maxLength?: number | undefined
  readonly className?: string | undefined
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const canSend = !props.disabled && props.value.trim().length > 0
  const send = () => {
    if (canSend) props.onSubmit(props.value.trim())
  }
  return (
    <div
      className={`flex min-h-0 w-full flex-col overflow-hidden rounded-[14px] bg-surface shadow-card ${
        props.className ?? ""
      }`}
    >
      {props.header === undefined ?
        null :
        (
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2">
            {props.header}
          </div>
        )}

      <div ref={props.scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-2">
        <div className="flex flex-col gap-4">{props.children}</div>
      </div>

      <form
        method="post"
        className="shrink-0 p-2"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        <div
          role="presentation"
          onClick={() => inputRef.current?.focus()}
          className="flex cursor-text items-end gap-2 rounded-control border border-line bg-field p-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.035)] transition-[border-color,box-shadow] duration-150 focus-within:border-line-strong"
        >
          <textarea
            ref={inputRef}
            rows={1}
            value={props.value}
            maxLength={props.maxLength}
            disabled={props.disabled}
            onChange={(event) => props.onChange(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends; Shift+Enter is a new line — the convention every chat surface uses.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                send()
              }
            }}
            placeholder={props.placeholder}
            aria-label={props.inputLabel}
            className="max-h-40 min-h-5 flex-1 resize-none bg-transparent text-[13px] leading-[1.45] text-ink outline-none [field-sizing:content] placeholder:text-ink-3 disabled:opacity-60"
          />
          <button
            type="submit"
            aria-label={props.submitLabel}
            title={props.submitLabel}
            disabled={!canSend}
            className="flex size-7 shrink-0 items-center justify-center rounded-[8px] transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.96]"
            style={{
              background: canSend ? "var(--ink)" : "var(--line-strong)",
              color: canSend ? "var(--surface)" : "var(--ink-2)"
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  )
}
