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
import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import { useCallback, useEffect, useState } from "react"
import { Highlight } from "./highlight.tsx"
import { Api } from "./rpc.ts"

const queueAtom = Api.query("Decision.queue", { limit: 50 })

export function QueueScreen() {
  const queue = useAtomValue(queueAtom)
  // A query atom is read-only; refreshing re-runs it. `useAtomSet` would be for a writable atom.
  const refreshQueue = useAtomRefresh(queueAtom)
  const [selected, setSelected] = useState(0)

  const items = queue._tag === "Success" ? queue.value : []
  const current = items[selected]

  const approve = useAtomSet(Api.mutation("Decision.approve"), {
    mode: "promise"
  })
  const reject = useAtomSet(Api.mutation("Decision.reject"), {
    mode: "promise"
  })

  const review = useCallback(
    async (action: "approve" | "reject") => {
      if (current === undefined) return
      const send = action === "approve" ? approve : reject
      const result = await send({
        payload: { decisionId: current.decisionId }
      })
      /*
       * `not_pending` means somebody else got there first — the CAS on the server rejected this review.
       * Refreshing rather than showing an error is the right response: the queue has moved on, and the
       * reviewer's next action should be against what is true now.
       */
      refreshQueue()
      // Keep the cursor in range as the list shrinks, so `a a a` works without the selection running off
      // the end — which is the whole point of a keyboard-first queue.
      setSelected((index) => Math.min(index, Math.max(items.length - 2, 0)))
      return result
    },
    [approve, current, items.length, refreshQueue, reject]
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
      <QueueGrid items={items} selected={selected} onSelect={setSelected} />
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

function QueueGrid({ items, onSelect, selected }: QueueGridProps) {
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
  const detail = useAtomValue(Api.query("Decision.get", { decisionId }))

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

      <footer style={{ marginTop: "2rem", color: "#666", fontSize: "0.85rem" }}>
        <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>a</kbd> approve · <kbd>r</kbd> reject
      </footer>
    </section>
  )
}
