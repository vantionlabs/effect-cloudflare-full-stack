/**
 * The conversation on one decision.
 *
 * The product's claim is that an automatic decision can be audited a year later. The citations make the
 * machine's reasoning legible; this makes the humans' — why a reviewer approved something despite a rail, or
 * what they checked before rejecting it, next to the decision rather than in a chat app nobody can query.
 *
 * Live updates arrive by invalidation, not by appending: `realtime-bridge.tsx` invalidates this thread's key
 * when a `MessagePosted` frame names it, and the query re-reads. So the socket makes it timely and the
 * database remains the only source of what it contains.
 */
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { useCallback, useState } from "react"
import { postMessageAtom, threadAtom } from "./thread-atoms.ts"

export function Thread({ decisionId }: { readonly decisionId: string }) {
  const thread = useAtomValue(threadAtom(decisionId))
  const post = useAtomSet(postMessageAtom, { mode: "promise" })
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)

  const messages = thread._tag === "Success" ? thread.value : []

  const send = useCallback(async () => {
    const body = draft.trim()
    if (body === "" || sending) return
    setSending(true)
    /*
     * The draft is cleared BEFORE the await, so the next message can be typed immediately — and restored if the
     * post fails. Clearing after would swallow whatever was typed during the round trip, which on a slow
     * connection is the whole point of typing ahead.
     */
    setDraft("")
    try {
      await post({ payload: { subjectKind: "decision", subjectId: decisionId, body } })
    } catch (error) {
      setDraft(body)
      throw error
    } finally {
      setSending(false)
    }
  }, [decisionId, draft, post, sending])

  return (
    <section style={{ borderTop: "1px solid #ddd", marginTop: "1.5rem", paddingTop: "1rem" }}>
      <h3 style={{ font: "600 0.8rem ui-sans-serif", color: "#666", margin: "0 0 0.75rem" }}>
        NOTES · {messages.length}
      </h3>

      {messages.length === 0
        ? <p style={{ color: "#888", fontSize: "0.85rem" }}>No notes yet. Say what you checked.</p>
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

      <form
        /*
         * `method="post"` and a disabled control while sending, for the reasons in `login.tsx`: before
         * hydration the browser owns this form, and a GET submission would put the note in the URL.
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
          placeholder="Add a note"
          aria-label="Add a note"
          /*
           * `j`/`k`/`a`/`r` are document-level shortcuts; the handler already ignores events from inputs, so
           * typing "a" here does not approve the decision. That check is in queue-screen.tsx and this input is
           * the reason it exists.
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
