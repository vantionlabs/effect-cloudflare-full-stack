/**
 * The queue's data layer: one query, two mutations, and the invalidation that ties them together.
 *
 * **`reactivityKeys` rather than a manual refresh.** `AtomRpc` wires a query to the `Reactivity` service, and
 * a mutation declaring the same key invalidates it on success — so approving a decision re-runs the queue
 * query without any component asking it to. The first version called `useAtomRefresh` by hand after each
 * mutation, which worked and put the cache-invalidation rule in the screen: every new caller had to remember
 * it, and a caller that forgot showed a stale queue rather than failing.
 *
 * It also gives the socket somewhere to push. A `QueueChanged` frame invalidates the same key
 * (`realtime-bridge.tsx`), so a change made by a colleague and a change made here take the identical path
 * through the atom graph. One way for queue data to arrive means a live update and a reload cannot disagree.
 */
import { Atom } from "effect/reactivity"
import { Api } from "./rpc.ts"

/**
 * The key everything about decisions hangs off.
 *
 * Deliberately coarse. A per-decision key would invalidate less, and would also need every writer to know
 * which ids its change affected — which the socket's nudge deliberately does not carry. The queue is fifty
 * rows behind one round trip; precision here would buy nothing and cost a class of bug where a change
 * invalidates the wrong key and nothing updates.
 */
export const DECISIONS_KEY = "decisions"

export const queueAtom = Api.query("Decision.queue", { limit: 50 }, { reactivityKeys: [DECISIONS_KEY] })

/**
 * One decision's detail, keyed by id.
 *
 * `Atom.family` rather than `Api.query(...)` inside the component, which is what this was. Calling `query`
 * during render builds a NEW atom every render: nothing is cached, the request is re-issued, and the atom's
 * own loading state is discarded each time — so the inspector refetched on every keystroke in the queue. A
 * family keeps one atom per id, held weakly, so navigating back to a decision is instant and navigating away
 * lets it go.
 *
 * It carries the same reactivity key as the queue, so approving something also refreshes the detail that is
 * open — the row and its inspector cannot show different statuses.
 */
export const decisionAtom = Atom.family((decisionId: string) =>
  Api.query("Decision.get", { decisionId }, { reactivityKeys: [DECISIONS_KEY] })
)

/**
 * The mutations. Note where the key goes: `query` takes `reactivityKeys` when the atom is DEFINED, but a
 * mutation takes them **per call**, alongside the payload — so `REVIEW_KEYS` below is what call sites pass,
 * and it exists so that neither of them can quietly forget to.
 */
export const approveAtom = Api.mutation("Decision.approve")
export const rejectAtom = Api.mutation("Decision.reject")

/** Pass with every review, so a successful one re-runs the queue query without anybody refreshing it. */
export const REVIEW_KEYS = [DECISIONS_KEY]

/**
 * Rows hidden while their review is in flight — the optimistic half.
 *
 * The queue is keyboard-driven: `a a a` approves three invoices as fast as somebody can press a key. Waiting
 * for a round trip before removing a row means the cursor lands on a row that is already gone, so the second
 * keystroke reviews the wrong decision. Hiding immediately makes the list behave the way the reviewer's hands
 * assume it does.
 *
 * A set of ids to SUBTRACT, rather than an edited copy of the queue. That distinction is what keeps this
 * honest: the server's answer stays the only queue data, so a failed mutation restores the truth by removing
 * an id from this set rather than by reconstructing a row from a guess. Nothing here is ever rendered as
 * content — it only hides — so the worst case of a bug in it is a row that reappears.
 */
const noneReviewing: ReadonlySet<string> = new Set()
export const reviewingAtom = Atom.make(noneReviewing)
