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
import { Notice } from "@/components/feedback/notice"
import { useIdentity } from "@/hooks/use-session"
import { enter } from "@/lib/motion"
import { usePresence } from "@/realtime/use-presence"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { CheckCheck } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { approveAtom, queueAtom, rejectAtom, REVIEW_KEYS, reviewingAtom } from "./api/queue-atoms.ts"
import { DecisionInspector, InspectorSkeleton } from "./components/decision-inspector.tsx"
import { QueueList, QueueListSkeleton } from "./components/queue-list.tsx"

export function QueuePage() {
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
    return (
      <main className="p-8">
        <Notice tone="error">
          De wachtrij kon niet worden geladen. Vernieuw de pagina om het opnieuw te proberen.
        </Notice>
      </main>
    )
  }

  return (
    <main className="grid min-h-0 flex-1 grid-rows-[auto_1fr] md:h-dvh md:grid-cols-[22rem_1fr] md:grid-rows-1">
      {
        /*
         * The server renders the queue (`load-queue-page.ts`), so `Initial` is only seen when the browser fetches it
         * itself — and then the list's SHAPE stands in, never an empty state that would claim there is nothing to do.
         */
      }
      {queue._tag === "Initial"
        ? <QueueListSkeleton />
        : <QueueList items={items} selected={selected} onSelect={setSelected} others={others} />}
      {queue._tag === "Initial"
        ? <InspectorSkeleton />
        : current === undefined
        ? <EmptyQueue />
        : <DecisionInspector decisionId={current.decisionId} />}
    </main>
  )
}

/** Nothing pending — said so, with what will make something appear. */
function EmptyQueue() {
  return (
    <section className="flex flex-col items-start gap-2 p-8 md:p-12" style={enter(0)}>
      <span className="flex size-9 items-center justify-center rounded-card bg-green-tint text-green">
        <CheckCheck className="size-5" aria-hidden />
      </span>
      <h2 className="text-[15px] font-semibold text-ink">Niets te beoordelen</h2>
      <p className="max-w-sm text-[13px] text-ink-2">
        Nieuwe documenten verschijnen hier zodra ze binnenkomen. Alles wat het systeem niet zelf mag beslissen, komt
        hier terecht, met de reden erbij.
      </p>
    </section>
  )
}
