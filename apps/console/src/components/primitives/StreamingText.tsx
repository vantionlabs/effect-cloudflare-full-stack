/**
 * An answer in a conversation, with its actions and its sources — Beautiful UI's StreamingText (MIT, see
 * components/BEAUTIFUL-UI-LICENSE), kept for its layout: the prose, a quiet action row, and a sources toggle whose
 * list opens in place.
 *
 * LOCAL CHANGE (effect-ai): the registry version replayed a hard-coded answer word by word on a 55ms timer and looped
 * it, invented three external "sources" with images and links, hard-coded "10 sources", suggested follow-ups nobody
 * computed, and showed four icon buttons labelled "Action" that did nothing. All gone. An answer here arrives WHOLE
 * (it is verified before it is shown — see AskCorpus.ts), so it is rendered whole; the one action is a working copy;
 * the sources drawer holds whatever the caller passes, which for this product is the verified citations.
 */
import { type ReactNode, useState } from "react"

export default function StreamingText(props: {
  readonly text: string
  /** How many sources the drawer holds; the toggle is hidden when there are none. */
  readonly sourceCount: number
  /** The drawer's content — the citations. */
  readonly sources?: ReactNode | undefined
  /** Open the sources from the start — for the newest answer, whose sources are what the reader checks next. */
  readonly sourcesOpen?: boolean | undefined
  readonly labels: {
    readonly sources: (count: number) => string
    readonly copy: string
    readonly copied: string
  }
}) {
  const [open, setOpen] = useState(props.sourcesOpen === true)
  const [copied, setCopied] = useState(false)
  const paragraphs = props.text.split(/\n{2,}/).filter((paragraph) => paragraph.trim() !== "")
  return (
    <div className="w-full">
      <div className="flex flex-col gap-2 text-[13px] leading-relaxed text-ink">
        {paragraphs.map((paragraph, index) => <p key={index} className="whitespace-pre-wrap">{paragraph}</p>)}
      </div>

      <div className="mt-2 flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(props.text).then(
              () => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1600)
              },
              () => undefined
            )
          }}
          className="flex h-6 items-center gap-1 rounded-[6px] px-1.5 text-[12px] text-ink-3 transition-colors duration-100 hover:bg-hover-2 hover:text-ink-2"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <rect x="9" y="9" width="12" height="12" rx="2.5" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          <span aria-live="polite">{copied ? props.labels.copied : props.labels.copy}</span>
        </button>
        {props.sourceCount === 0 ? null : (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
            className="ml-1 flex h-6 items-center gap-1.5 rounded-[6px] px-1.5 text-[12px] text-ink-2 transition-colors duration-150 hover:bg-hover"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              style={{
                transform: open ? "rotate(90deg)" : "none",
                transition: "transform 200ms cubic-bezier(0.23,1,0.32,1)"
              }}
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
            {props.labels.sources(props.sourceCount)}
          </button>
        )}
      </div>

      <div
        className="grid transition-[grid-template-rows,opacity] duration-300"
        style={{
          gridTemplateRows: open ? "1fr" : "0fr",
          opacity: open ? 1 : 0,
          transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)"
        }}
        inert={!open}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="pt-2">{props.sources}</div>
        </div>
      </div>
    </div>
  )
}
