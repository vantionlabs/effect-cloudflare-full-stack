/**
 * The queue and the inspector, keyboard-first.
 *
 * The product's claim is that a reviewer can audit an automatic decision, so this screen's job is to make the
 * *reasons* legible rather than to be pretty: which rails fired, whether retrieval was degraded, and — the
 * important one — whether each cited excerpt actually occurs in the clause it names.
 *
 * `j`/`k` move, `a` approves, `r` rejects. Bound once on the document rather than per row, so a shortcut never
 * depends on which element has focus — a reviewer who clicked a citation should still be able to press `a`.
 */
import type { Viewer } from "@ea/modules/realtime/domain/Room"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Highlight } from "./highlight.tsx"
import { useIdentity } from "./hooks/use-session.ts"
import { approveAtom, decisionAtom, queueAtom, rejectAtom, REVIEW_KEYS, reviewingAtom } from "./queue-atoms.ts"
import { usePresence } from "./realtime/use-presence.ts"
import { Thread } from "./thread.tsx"

export function QueueScreen() {
  const queue = useAtomValue(queueAtom)
  const [selected, setSelected] = useState(0)
  const identity = useIdentity()
  const presence = usePresence()

  /*
   * The mutation atoms come from module scope, and that matters more than it looks.
   *
   * They used to be created inside this component — `useAtomSet(Api.mutation("Decision.approve"))` — which
   * builds a NEW atom on every render, so the mutation's own state was thrown away and rebuilt each time and
   * every `useCallback` depending on it was invalidated. It worked because the result was awaited directly;
   * it would have broken the moment anything read the mutation atom's pending or error state.
   */
  const approve = useAtomSet(approveAtom, { mode: "promise" })
  const reject = useAtomSet(rejectAtom, { mode: "promise" })
  const reviewing = useAtomValue(reviewingAtom)
  const setReviewing = useAtomSet(reviewingAtom)

  /*
   * The optimistic subtraction. The server's answer is the only queue data; this only ever HIDES rows.
   *
   * Memoised on the two inputs so that a re-render caused by anything else — presence arriving, the cursor
   * moving — does not rebuild the array and, through it, every row.
   */
  const items = useMemo(() => {
    const rows = queue._tag === "Success" ? queue.value : []
    return reviewing.size === 0 ? rows : rows.filter((row) => !reviewing.has(row.decisionId))
  }, [queue, reviewing])

  const current = items[selected]

  /*
   * Presence follows the cursor, so colleagues see which invoice you are on rather than only that you are
   * here. Sent on change rather than on a timer: the room keeps it in the socket's attachment, so it costs
   * one frame per navigation and nothing while you read.
   *
   * `setViewing` is stable (a `useCallback` over a stable `send`), so this effect runs when the selection
   * changes and at no other time. Depending on a whole `presence` object here is what made an earlier version
   * fire on every frame that arrived.
   */
  const { connected, setViewing } = presence
  useEffect(() => {
    setViewing(current?.decisionId ?? null)
    /*
     * `connected` is a dependency, not noise. A send before the socket is open is DROPPED rather than queued
     * (see socket-provider.tsx), and this effect first runs on mount — before the upgrade completes. Without
     * re-running on connect, a reviewer who opened a decision immediately would appear to colleagues as
     * looking at nothing, and would stay that way until they moved. Re-sending on every reconnect is also
     * what restores presence after a deploy.
     */
  }, [current?.decisionId, setViewing, connected])

  /** Everybody except you — the list includes your own connection, which is not news to you. */
  const others = useMemo(
    () => presence.viewers.filter((viewer) => viewer.userId !== identity.id),
    [presence.viewers, identity.id]
  )

  const review = useCallback(
    async (action: "approve" | "reject") => {
      if (current === undefined) return
      const { decisionId } = current
      const send = action === "approve" ? approve : reject

      /*
       * Hidden before the round trip, restored only if it fails.
       *
       * The queue is keyboard-driven: `a a a` is three keystrokes faster than three round trips, and without
       * this the cursor lands on a row the server is about to remove, so the second keystroke reviews the
       * wrong decision.
       *
       * Note what is NOT done here: nothing invents a row or edits one. The hidden set is subtracted from
       * whatever the server last said, so the worst outcome of a bug in this is a row that reappears.
       */
      setReviewing((hidden) => new Set(hidden).add(decisionId))
      // The cursor stays in range as the list shrinks, which is the whole point of a keyboard-first queue.
      setSelected((index) => Math.min(index, Math.max(items.length - 2, 0)))

      try {
        /*
         * `reactivityKeys` per call — a mutation takes them here rather than at definition — so a successful
         * review re-runs the queue query on its own. There is no manual refresh anywhere in this file now.
         *
         * `not_pending` counts as success: somebody else got there first, the row is no longer pending, and
         * it should stay hidden. The reviewer's next action should be against what is true now, which is what
         * the invalidated query fetches.
         */
        return await send({ payload: { decisionId }, reactivityKeys: REVIEW_KEYS })
      } catch (error) {
        /*
         * The row comes back. A review that failed — network, or a 500 — has NOT happened, and leaving it
         * hidden would tell the reviewer it was handled. This is the rollback the optimistic hide is only
         * safe because of.
         */
        setReviewing((hidden) => {
          const next = new Set(hidden)
          next.delete(decisionId)
          return next
        })
        throw error
      }
    },
    [approve, current, items.length, reject, setReviewing]
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Never hijack typing. A reviewer writing a note must be able to type "a".
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target !== null && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) {
        return
      }

      switch (event.key) {
        case "j":
          setSelected((index) => Math.min(index + 1, Math.max(items.length - 1, 0)))
          return
        case "k":
          setSelected((index) => Math.max(index - 1, 0))
          return
        case "a":
          void review("approve")
          return
        case "r":
          void review("reject")
          return
        default:
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [items.length, review])

  if (queue._tag === "Failure") {
    return <main style={{ padding: "2rem" }}>could not load the queue</main>
  }

  return (
    <main
      style={{
        display: "grid",
        gridTemplateColumns: "26rem 1fr",
        height: "100vh"
      }}
    >
      <QueueGrid items={items} selected={selected} onSelect={setSelected} others={others} />
      {current === undefined ?
        (
          <section style={{ padding: "2rem", color: "#666" }}>
            the queue is empty
          </section>
        ) :
        <Inspector decisionId={current.decisionId} />}
    </main>
  )
}

interface QueueGridProps {
  /** Other people connected to this organization's room, and what they have open. */
  readonly others: ReadonlyArray<Viewer>
  readonly items: ReadonlyArray<{
    readonly decisionId: string
    readonly filename: string
    readonly outcome: string
    readonly railsFired: ReadonlyArray<string>
    readonly retrievalMode: string
    readonly grounded: boolean
  }>
  readonly selected: number
  readonly onSelect: (index: number) => void
}

function QueueGrid({ items, onSelect, others, selected }: QueueGridProps) {
  return (
    <nav style={{ borderRight: "1px solid #ddd", overflowY: "auto" }}>
      <h1
        style={{
          font: "600 0.8rem ui-sans-serif",
          padding: "1rem",
          margin: 0,
          color: "#666"
        }}
      >
        REVIEW QUEUE · {items.length} · oldest first
        {
          /*
           * Who else is here, and on what.
           *
           * The point is the one failure this does not otherwise prevent: two reviewers opening the same
           * invoice, one approving it, and the other discovering that from a lost CAS race. Seeing a
           * colleague on a row is the cheap half of that — the CAS is still what makes it safe.
           *
           * Absent entirely when nobody else is connected, rather than rendering "0 others": an empty
           * indicator is noise on the screen of the person working alone, which is most of the time.
           */
        }
        {others.length === 0 ?
          null :
          (
            <span
              style={{ marginLeft: "0.75rem", color: "#888", fontWeight: 400 }}
              title={others.map((viewer) => viewer.email).join(", ")}
            >
              · {others.length} other{others.length === 1 ? "" : "s"} here
            </span>
          )}
      </h1>
      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {items.map((item, index) => (
          <li
            key={item.decisionId}
            onClick={() => onSelect(index)}
            style={{
              padding: "0.75rem 1rem",
              borderBottom: "1px solid #eee",
              background: index === selected ? "#eef3ff" : undefined,
              cursor: "pointer"
            }}
          >
            <div style={{ fontWeight: 600 }}>{item.filename}</div>
            {
              /*
              Why it needs a human, in the grid. A reviewer triaging forty items should not have to open each
              one to learn that retrieval was degraded, or that a span did not verify.
            */
            }
            <div style={{ fontSize: "0.8rem", color: "#555" }}>
              {item.outcome}
              {!item.grounded && <span style={{ color: "#b00" }}>· ungrounded</span>}
              {item.retrievalMode !== "hybrid" && (
                <span style={{ color: "#a60" }}>
                  · {item.retrievalMode} retrieval
                </span>
              )}
              {item.railsFired.length > 0 && <span>· {item.railsFired.length} rail(s)</span>}
            </div>
          </li>
        ))}
      </ol>
    </nav>
  )
}

function Inspector({ decisionId }: { readonly decisionId: string }) {
  // One atom per id, from module scope — see `decisionAtom` for why this must not be built during render.
  const detail = useAtomValue(decisionAtom(decisionId))

  if (detail._tag !== "Success" || detail.value === null) {
    return <section style={{ padding: "2rem", color: "#666" }}>loading…</section>
  }
  const decision = detail.value

  return (
    <section style={{ padding: "2rem", overflowY: "auto" }}>
      <h2 style={{ margin: "0 0 0.25rem" }}>{decision.filename}</h2>
      <p style={{ color: "#666", margin: "0 0 1.5rem", fontSize: "0.9rem" }}>
        {decision.outcome} · {decision.retrievalMode} retrieval · {decision.model}
        {!decision.grounded && <strong style={{ color: "#b00" }}>· ungrounded</strong>}
      </p>

      {decision.railsFired.length > 0 && (
        <div
          style={{
            background: "#fff8e6",
            border: "1px solid #e8d8a8",
            padding: "1rem",
            marginBottom: "1.5rem"
          }}
        >
          <strong style={{ fontSize: "0.85rem" }}>
            why this is not automatic
          </strong>
          <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem" }}>
            {decision.railsFired.map((rail) => <li key={rail}>{rail}</li>)}
          </ul>
        </div>
      )}

      <p style={{ marginBottom: "1.5rem" }}>{decision.rationale}</p>

      <h3 style={{ font: "600 0.8rem ui-sans-serif", color: "#666" }}>
        CITATIONS
      </h3>
      {decision.citations.length === 0 && <p style={{ color: "#b00" }}>none — nothing to check against</p>}
      {decision.citations.map((cited, index) => (
        <article
          key={index}
          style={{
            border: "1px solid #ddd",
            padding: "1rem",
            marginBottom: "1rem"
          }}
        >
          <div
            style={{
              fontSize: "0.8rem",
              color: "#666",
              marginBottom: "0.5rem"
            }}
          >
            {cited.citation.clause_ref ?? cited.citation.chunk_id}
          </div>
          {cited.clauseText === null ?
            (
              /*
               * The chunk is gone — re-indexed or deleted. Worth saying rather than hiding: a decision whose
               * clause no longer exists cannot be audited the way it was made.
               */
              <p style={{ color: "#b00", margin: 0 }}>
                the cited clause is no longer in the corpus, so this citation cannot be re-checked
              </p>
            ) :
            (
              <Highlight
                text={cited.clauseText}
                excerpt={cited.citation.excerpt}
              />
            )}
        </article>
      ))}

      {/* The humans' reasoning, next to the machine's. See thread.tsx. */}
      <Thread kind="decision" id={decisionId} title="NOTES" />

      <footer style={{ marginTop: "2rem", color: "#666", fontSize: "0.85rem" }}>
        <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>a</kbd> approve · <kbd>r</kbd> reject
      </footer>
    </section>
  )
}
