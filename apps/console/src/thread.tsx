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
import { useIdentity } from "./hooks/use-session.ts"
import {
  decisionThreadAtom,
  deleteMessageAtom,
  editMessageAtom,
  postMessageAtom,
  QUICK_REACTIONS,
  reactAtom,
  roomThreadAtom
} from "./thread-atoms.ts"

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
  const identity = useIdentity()
  const edit = useAtomSet(editMessageAtom, { mode: "promise" })
  const remove = useAtomSet(deleteMessageAtom, { mode: "promise" })
  const react = useAtomSet(reactAtom, { mode: "promise" })
  /** Which message is being edited, and the draft for it. One at a time, which is all anybody does. */
  const [editing, setEditing] = useState<{ readonly id: string; readonly body: string } | undefined>(undefined)

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
                {/* "edited" is shown, not hidden: an edited note and an original are not the same evidence. */}
                {message.editedAt === null
                  ? null
                  : <span style={{ color: "#aaa", fontSize: "0.78rem" }}>{" "}· edited</span>}

                {message.deletedAt !== null
                  ? <div style={{ color: "#aaa", fontStyle: "italic" }}>message deleted</div>
                  : editing?.id === message.id
                  ? (
                    <form
                      method="post"
                      onSubmit={(event) => {
                        event.preventDefault()
                        void (async () => {
                          const body = editing.body.trim()
                          if (body === "") return
                          await edit({ payload: { messageId: message.id, body } })
                          setEditing(undefined)
                        })()
                      }}
                      style={{ display: "flex", gap: "0.35rem", marginTop: "0.2rem" }}
                    >
                      <input
                        value={editing.body}
                        onChange={(event) => setEditing({ id: message.id, body: event.target.value })}
                        aria-label="Edit message"
                        style={{ flex: 1, font: "inherit", padding: "0.25rem 0.35rem" }}
                      />
                      <button type="submit" style={{ font: "inherit" }}>Save</button>
                      <button type="button" onClick={() => setEditing(undefined)} style={{ font: "inherit" }}>
                        Cancel
                      </button>
                    </form>
                  )
                  : (
                    <div style={{ whiteSpace: "pre-wrap" }}>
                      {message.body}
                      {
                        /*
                         * Only on your own messages. The server refuses anything else (`NotMessageAuthor`), so
                         * this is the UI agreeing with the rule rather than enforcing it — there is deliberately
                         * no moderator override anywhere.
                         */
                      }
                      {message.authorUserId !== identity.id ?
                        null :
                        (
                          <span style={{ marginLeft: "0.5rem", fontSize: "0.78rem" }}>
                            <button
                              type="button"
                              onClick={() => setEditing({ id: message.id, body: message.body })}
                              style={{
                                font: "inherit",
                                border: 0,
                                background: "none",
                                color: "#888",
                                cursor: "pointer"
                              }}
                            >
                              edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void remove({ payload: { messageId: message.id } })}
                              style={{
                                font: "inherit",
                                border: 0,
                                background: "none",
                                color: "#888",
                                cursor: "pointer"
                              }}
                            >
                              delete
                            </button>
                          </span>
                        )}
                    </div>
                  )}

                {
                  /*
                   * Reactions: what is already there, then the quick picks.
                   *
                   * Rendered for a deleted message too — people did react, and the row still records it. Hiding
                   * them would be a second, quieter kind of deletion that nobody asked for.
                   */
                }
                <div style={{ display: "flex", gap: "0.25rem", marginTop: "0.2rem", alignItems: "center" }}>
                  {message.reactions.map((reaction) => (
                    <button
                      key={reaction.emoji}
                      type="button"
                      aria-pressed={reaction.mine}
                      title={reaction.mine ? "Remove your reaction" : "Add your reaction"}
                      onClick={() => void react({ payload: { messageId: message.id, emoji: reaction.emoji } })}
                      style={{
                        font: "inherit",
                        fontSize: "0.78rem",
                        padding: "0.05rem 0.35rem",
                        borderRadius: "999px",
                        // The outline says whether YOU reacted, which is the only part that differs per reader.
                        border: reaction.mine ? "1px solid #888" : "1px solid #ddd",
                        background: reaction.mine ? "#eee" : "transparent",
                        cursor: "pointer"
                      }}
                    >
                      {reaction.emoji} {reaction.count}
                    </button>
                  ))}

                  {QUICK_REACTIONS.filter((emoji) => !message.reactions.some((reaction) => reaction.emoji === emoji))
                    .map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        title={`React with ${emoji}`}
                        onClick={() => void react({ payload: { messageId: message.id, emoji } })}
                        style={{
                          font: "inherit",
                          fontSize: "0.78rem",
                          border: 0,
                          background: "none",
                          opacity: 0.35,
                          cursor: "pointer"
                        }}
                      >
                        {emoji}
                      </button>
                    ))}
                </div>
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
