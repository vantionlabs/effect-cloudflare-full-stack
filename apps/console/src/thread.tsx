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
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { useCallback, useMemo, useState } from "react"
import { decisionThreadAtom, postMessageAtom, roomThreadAtom } from "./thread-atoms.ts"

export function Thread({
  id,
  kind,
  title
}: {
  readonly kind: "decision" | "room"
  readonly id: string
  /** What to call the panel. The queue calls it NOTES; a channel uses its own name. */
  readonly title: string
}) {
  const thread = useAtomValue(kind === "decision" ? decisionThreadAtom(id) : roomThreadAtom(id))
  const post = useAtomSet(postMessageAtom, { mode: "promise" })
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [rejected, setRejected] = useState<string | undefined>(undefined)

  const messages = thread._tag === "Success" ? thread.value : []

  /** Memoised on the primitives, so the payload is stable and `send` is not rebuilt each render. */
  const room = useMemo(
    () =>
      kind === "decision"
        ? ({ _tag: "RoomForDecision", decisionId: id } as const)
        : ({ _tag: "RoomById", roomId: id } as never),
    [kind, id]
  )

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
    try {
      await post({ payload: { room, body } })
    } catch (error) {
      setDraft(body)
      /*
       * The server's refusal, shown rather than thrown. `RoomArchived` is the one a user can act on — the
       * channel is closed, un-archive it or post elsewhere — and it is the reason that error is typed at all.
       */
      setRejected(String((error as { readonly _tag?: string })._tag ?? "Message not sent"))
    } finally {
      setSending(false)
    }
  }, [draft, post, room, sending])

  return (
    <section style={{ borderTop: "1px solid #ddd", marginTop: "1.5rem", paddingTop: "1rem" }}>
      <h3 style={{ font: "600 0.8rem ui-sans-serif", color: "#666", margin: "0 0 0.75rem" }}>
        {title} · {messages.length}
      </h3>

      {messages.length === 0
        ? <p style={{ color: "#888", fontSize: "0.85rem" }}>Nothing here yet.</p>
        : (
          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.6rem" }}>
            {messages.map((message) => (
              <li key={message.id} style={{ fontSize: "0.85rem" }}>
                <span style={{ color: "#666" }}>
                  {/* Falls back to the id when the author's row is gone — a deleted user leaves their notes. */}
                  {message.authorEmail ?? message.authorUserId}
                </span>{" "}
                <time dateTime={message.createdAt} style={{ color: "#aaa", fontSize: "0.78rem" }}>
                  {new Date(message.createdAt).toLocaleString()}
                </time>
                <div style={{ whiteSpace: "pre-wrap" }}>{message.body}</div>
              </li>
            ))}
          </ol>
        )}

      {rejected === undefined ?
        null :
        <p role="alert" style={{ color: "#b00", fontSize: "0.8rem", marginTop: "0.5rem" }}>{rejected}</p>}

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
        style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem" }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Write a message"
          aria-label="Write a message"
          /*
           * `j`/`k`/`a`/`r` are document-level shortcuts; the handler ignores events from inputs, so typing "a"
           * here does not approve a decision. That check lives in queue-screen.tsx and this input is why.
           */
          style={{ flex: 1, padding: "0.4rem 0.5rem", font: "inherit" }}
        />
        <button type="submit" disabled={draft.trim() === "" || sending} style={{ font: "inherit" }}>
          {sending ? "Sending…" : "Send"}
        </button>
      </form>
    </section>
  )
}
