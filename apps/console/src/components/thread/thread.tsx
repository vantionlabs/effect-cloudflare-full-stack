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
 */
import { Button } from "@/components/atoms/Button"
import { Notice } from "@/components/feedback/notice"
import { Input } from "@/components/ui/input"
import { useHydrated } from "@/hooks/use-hydrated"
import { useIdentity } from "@/hooks/use-session"
import { describeFailure } from "@/lib/failure"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Exit } from "effect"
import { useCallback, useEffect, useMemo, useState } from "react"
import { decisionThreadAtom, markReadAtom, postMessageAtom, roomThreadAtom } from "./thread-atoms.ts"
import { ThreadMessage } from "./thread-message.tsx"

export function Thread({
  id,
  kind,
  title
}: {
  readonly kind: "decision" | "room"
  readonly id: string
  /** What to call the panel. The queue calls it NOTES; a channel uses MESSAGES. */
  readonly title: string
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
        RoomArchived: "This channel is archived, so the message was not sent."
      }))
    }
    setSending(false)
  }, [draft, post, room, sending])

  return (
    <section className="flex flex-col gap-3 border-t border-line pt-4">
      <h3 className="text-[12px] font-semibold tracking-wide text-ink-2 uppercase">
        {title} · {messages.length}
      </h3>

      {messages.length === 0
        ? <p className="text-[13px] text-ink-3">Nothing here yet.</p>
        : (
          <ol className="flex flex-col gap-4">
            {messages.map((message) => <ThreadMessage key={message.id} message={message} viewerId={identity.id} />)}
          </ol>
        )}

      {rejected === undefined ? null : <Notice tone="error">{rejected}</Notice>}

      <form
        /*
         * `method="post"` and a disabled control while sending, for the reasons in `login.tsx`: before hydration
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
          placeholder="Write a message"
          aria-label="Write a message"
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
          {sending ? "Sending…" : "Send"}
        </Button>
      </form>
    </section>
  )
}
