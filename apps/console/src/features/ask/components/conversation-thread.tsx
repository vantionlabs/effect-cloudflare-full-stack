/**
 * A conversation, in Beautiful UI's ChatComposer shell: the turns so far, the question being asked, and the composer.
 *
 * While a question is in flight it is shown at once, as asked, with `LoadingState`'s real elapsed time — nothing
 * about the search steps is invented (the answer arrives whole, after its citations are verified). The thread stays
 * pinned to the newest turn unless the reader scrolled up to read (`useStickToBottom`), and only turns that ARRIVE
 * animate in (`useArrivals` + `enter`), so opening a long conversation does not replay it.
 */
import { Notice } from "@/components/feedback/notice"
import ChatComposer, { ChatQuestion } from "@/components/primitives/ChatComposer"
import LoadingState from "@/components/primitives/LoadingState"
import { useArrivals } from "@/hooks/use-arrivals"
import { useHydrated } from "@/hooks/use-hydrated"
import { useStickToBottom } from "@/hooks/use-stick-to-bottom"
import { enter } from "@/lib/motion"
import type { AssistantTurn } from "@ea/modules/policy/domain/Assistant"
import { BookOpenText } from "lucide-react"
import { type ReactNode, useRef, useState } from "react"
import { ConversationTurn } from "./conversation-turn.tsx"

/** Mirrors the server's own cap, so a long question is cut visibly here rather than silently there. */
const MAX_QUESTION_LENGTH = 2000

const turnId = (turn: typeof AssistantTurn.Encoded) => `${turn.askedAt}|${turn.question}`

export function ConversationThread(props: {
  readonly turns: ReadonlyArray<typeof AssistantTurn.Encoded>
  /** The question being answered right now, if any. */
  readonly pending: string | undefined
  readonly failure: string | undefined
  readonly header: ReactNode
  readonly onAsk: (question: string) => void
}) {
  const hydrated = useHydrated()
  const [draft, setDraft] = useState("")
  const scroller = useRef<HTMLDivElement>(null)
  useStickToBottom(scroller)
  const arrived = useArrivals(props.turns, turnId)
  // ES2022 lib has no `findLastIndex`; the newest answered turn is the one whose sources open by default.
  const lastAnswered = props.turns.reduce((found, turn, index) => (turn.answer === undefined ? found : index), -1)

  return (
    <ChatComposer
      className="h-[min(72dvh,720px)] max-md:h-[70dvh]"
      header={props.header}
      scrollRef={scroller}
      value={draft}
      onChange={setDraft}
      onSubmit={(question) => {
        props.onAsk(question.slice(0, MAX_QUESTION_LENGTH))
        setDraft("")
      }}
      disabled={!hydrated || props.pending !== undefined}
      maxLength={MAX_QUESTION_LENGTH}
      placeholder="Stel een vraag over je handleidingen, bijv. wat is de maximale werkdruk van de PK 23.500?"
      inputLabel="Vraag"
      submitLabel="Vraag stellen"
    >
      {props.turns.length === 0 && props.pending === undefined
        ? (
          <div className="flex flex-col items-start gap-2 py-6 text-[13px] text-ink-2">
            <BookOpenText className="size-5 text-ink-3" aria-hidden />
            <p className="max-w-md leading-relaxed">
              Antwoorden komen alleen uit je eigen handleidingen, schema's en servicebulletins, met de passage waarop ze
              steunen. Je kunt doorvragen; het gesprek wordt bewaard.
            </p>
          </div>
        )
        : null}

      {props.turns.map((turn, index) => (
        <div key={turnId(turn)} style={arrived.has(turnId(turn)) ? enter(arrived.get(turnId(turn))) : undefined}>
          <ConversationTurn turn={turn} latest={index === lastAnswered && props.pending === undefined} />
        </div>
      ))}

      {props.pending === undefined ? null : (
        <div className="flex flex-col gap-2" style={enter(0)} aria-busy="true">
          <ChatQuestion pending>{props.pending}</ChatQuestion>
          <LoadingState label="Zoeken in de documentatie" />
        </div>
      )}

      {props.failure === undefined ? null : <Notice tone="error">{props.failure}</Notice>}
    </ChatComposer>
  )
}
