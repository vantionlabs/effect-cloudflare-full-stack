/**
 * A room's messages, and a box to add one.
 *
 * Used for both kinds of room, which is why it takes a `kind` and an `id` rather than a `RoomRef` object: the
 * ids are primitives, so the atom family memoises on them, whereas a fresh `{ _tag, decisionId }` literal each
 * render would key a new atom every time — the same class of bug as building a query atom inside a component.
 *
 * Live updates arrive by invalidation, not by appending: `realtime-bridge.tsx` invalidates this thread's key
 * when a `MessagePosted` frame names it, and the query re-reads. So the socket makes it timely and the database
 * remains the only source of what it contains.
 *
 * Two layouts. `fill` (a chat channel) takes the pane's height: the messages scroll on their own and stay pinned to
 * the newest one while the reader is at the bottom (`useStickToBottom`), with the composer fixed beneath. `inline`
 * (a decision's notes, inside the inspector) flows with the page. Messages that ARRIVE while the thread is open enter
 * with `fade-up`; the ones it opened with do not.
 */
import { Button } from "@/components/atoms/Button"
import { Notice } from "@/components/feedback/notice"
import { Skeleton } from "@/components/feedback/skeleton"
import { Input } from "@/components/ui/input"
import { useArrivals } from "@/hooks/use-arrivals"
import { useHydrated } from "@/hooks/use-hydrated"
import { useIdentity } from "@/hooks/use-session"
import { useStickToBottom } from "@/hooks/use-stick-to-bottom"
import { describeFailure } from "@/lib/failure"
import { enter } from "@/lib/motion"
import { cn } from "@/lib/utils"
import type { Message } from "@ea/modules/chat/domain/Message"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Exit } from "effect"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { decisionThreadAtom, markReadAtom, postMessageAtom, roomThreadAtom } from "./thread-atoms.ts"
import { ThreadMessage } from "./thread-message.tsx"

export function Thread({
  id,
  kind,
  layout = "inline",
  title
}: {
  readonly kind: "decision" | "room"
  readonly id: string
  /** What to call the panel. The queue calls it "Notities"; a channel uses "Berichten". */
  readonly title: string
  readonly layout?: "fill" | "inline"
}) {
  const thread = useAtomValue(kind === "decision" ? decisionThreadAtom(id) : roomThreadAtom(id))
  const post = useAtomSet(postMessageAtom, { mode: "promiseExit" })
  const markRead = useAtomSet(markReadAtom, { mode: "promise" })
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [rejected, setRejected] = useState<string | undefined>(undefined)
  const identity = useIdentity()
  // Gated until hydration, for the same reason as the new-channel form: a draft typed early is wiped.
  const hydrated = useHydrated()

  const messages = thread._tag === "Success" ? thread.value : []

  /** Memoised on the primitives, so the payload is stable and `send` is not rebuilt each render. */
  const room = useMemo(
    () =>
      kind === "decision"
        ? ({ _tag: "RoomForDecision", decisionId: id } as const)
        : ({ _tag: "RoomById", roomId: id } as never),
    [kind, id]
  )

  /*
   * Mark read up to the newest message on show.
   *
   * Effect rather than a scroll listener: "the thread is open and these messages are rendered" is the honest
   * condition, and a scroll position is a proxy for it that gets complicated fast. `MarkRead` is idempotent and
   * monotonic, so calling it on every render of a new last message is cheap and cannot move the marker backwards.
   *
   * Only for a channel. A decision's thread has no unread badge to clear — it is reached through the queue, not
   * through a list — so marking it would write a row nothing reads.
   */
  const newest = messages.at(-1)?.id
  useEffect(() => {
    if (kind !== "room" || newest === undefined) return
    void markRead({ payload: { roomId: id as never, messageId: newest } })
  }, [id, kind, markRead, newest])

  const send = useCallback(async () => {
    const body = draft.trim()
    if (body === "" || sending) return
    setSending(true)
    setRejected(undefined)
    /*
     * The draft is cleared BEFORE the await, so the next message can be typed immediately — and restored if the
     * post fails. Clearing after would swallow whatever was typed during the round trip, which on a slow
     * connection is the whole point of typing ahead.
     */
    setDraft("")
    const exit = await post({ payload: { room, body } })
    if (Exit.isFailure(exit)) {
      setDraft(body)
      /*
       * The server's refusal, shown rather than thrown. `RoomArchived` is the one a user can act on — the channel
       * is closed, un-archive it or post elsewhere — and it is the reason that error is typed at all.
       */
      setRejected(describeFailure(exit, {
        RoomArchived: "Dit kanaal is gearchiveerd, dus het bericht is niet verstuurd."
      }))
    }
    setSending(false)
  }, [draft, post, room, sending])

  const fill = layout === "fill"
  return (
    <section
      className={cn(
        "flex flex-col gap-3",
        fill ? "min-h-0 flex-1" : "border-t border-line pt-4"
      )}
    >
      <h3 className="text-[13px] font-semibold text-ink">
        {title} <span className="font-normal text-ink-3">· {messages.length}</span>
      </h3>

      {thread._tag === "Initial"
        ? <ThreadSkeleton />
        : <MessageList messages={messages} viewerId={identity.id} fill={fill} />}

      {rejected === undefined ? null : <Notice tone="error">{rejected}</Notice>}

      <form
        /*
         * `method="post"` and a disabled control while sending, for the reasons in `login-page.tsx`: before hydration
         * the browser owns this form, and a GET submission would put the message in the URL.
         */
        method="post"
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
        className="flex gap-2"
      >
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Schrijf een bericht"
          aria-label="Schrijf een bericht"
          disabled={!hydrated}
          /*
           * `j`/`k`/`a`/`r` are document-level shortcuts; the handler ignores events from inputs, so typing "a"
           * here does not approve a decision. That check lives in queue-page.tsx and this input is why.
           */
        />
        <Button
          type="submit"
          variant="primary"
          size="sm"
          className="h-8"
          disabled={!hydrated || draft.trim() === "" || sending}
        >
          {sending ? "Versturen…" : "Versturen"}
        </Button>
      </form>
    </section>
  )
}

function MessageList(props: {
  readonly messages: ReadonlyArray<Message>
  readonly viewerId: string
  readonly fill: boolean
}) {
  const scroller = useRef<HTMLDivElement>(null)
  useStickToBottom(scroller)
  const arrived = useArrivals(props.messages, (message) => message.id)

  /*
   * The scroller and its first child are ALWAYS rendered, empty or not: `useStickToBottom` attaches to them once, on
   * mount, so a channel that starts empty must already have them for its first message to stay in view.
   */
  return (
    <div ref={scroller} className={cn(props.fill && "min-h-0 flex-1 overflow-y-auto pr-1")}>
      <div>
        {props.messages.length === 0
          ? (
            <p className="text-[13px] text-ink-3">
              Nog geen berichten. Schrijf hieronder het eerste; iedereen in je organisatie kan het lezen.
            </p>
          )
          : (
            <ol className="flex flex-col">
              {props.messages.map((message, index) => {
                const slot = arrived.get(message.id)
                return (
                  <ThreadMessage
                    key={message.id}
                    message={message}
                    viewerId={props.viewerId}
                    continued={continues(props.messages[index - 1], message)}
                    style={slot === undefined ? undefined : enter(slot, { ms: 300 })}
                  />
                )
              })}
            </ol>
          )}
      </div>
    </div>
  )
}

/** Within five minutes of each other, a person's messages read as one turn: the name and time are shown once. */
const GROUP_MS = 5 * 60_000
const continues = (previous: Message | undefined, message: Message): boolean =>
  previous !== undefined &&
  previous.authorUserId === message.authorUserId &&
  Date.parse(message.createdAt) - Date.parse(previous.createdAt) < GROUP_MS

/** The thread's shape while its messages load in the browser. */
function ThreadSkeleton() {
  return (
    <div role="status" aria-label="Berichten laden" className="flex flex-col gap-4">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-32" />
          <Skeleton className={row === 1 ? "h-3.5 w-3/4" : "h-3.5 w-1/2"} />
        </div>
      ))}
    </div>
  )
}
