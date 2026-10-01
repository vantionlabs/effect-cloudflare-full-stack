/**
 * Realtime state that belongs to the app rather than to a screen.
 *
 * In atoms rather than React context so that a component reading presence re-renders when presence changes
 * and at no other time. Context would re-render every consumer of the socket on every frame, which is the
 * thing the provider's `useMemo` is already careful to avoid for connection status.
 */
import { decisionThreadKey, roomThreadKey } from "@/components/thread/thread-atoms"
import { ROOMS_KEY } from "@/features/chat/api/room-atoms"
import { DECISIONS_KEY } from "@/features/queue/api/queue-atoms"
import { Api } from "@/rpc/client"
import type { Viewer } from "@ea/realtime/Presence"
import { Effect } from "effect"
import { Atom, Reactivity } from "effect/reactivity"

/**
 * Everyone connected to this organization's room, including you.
 *
 * Written only by `realtime-bridge.tsx`, from `Welcome` and `Presence` frames. Both frames carry the whole
 * list, so both replace it — a delta protocol would be smaller and would require the client to stay in step
 * with a sequence number, for a list of a handful of names.
 */
export const viewersAtom = Atom.make<ReadonlyArray<Viewer>>([])

/**
 * Invalidate ONE thread, by subject.
 *
 * Keyed rather than coarse, unlike decisions: a busy tenant-wide channel would otherwise refetch every open
 * thread on every message. The key is computed from the frame's subject, so a client only re-reads the thread
 * it is actually showing.
 */
export const invalidateThreadAtom = Api.runtime.fn(
  Effect.fnUntraced(function*(roomId: string) {
    /*
     * Both spellings of the key, because a frame carries a room id and a thread may be registered under either:
     * a channel by room id, a decision's thread by decision id (which has no room until somebody posts).
     * Invalidating an unregistered key is a no-op, so this is cheaper than tracking the mapping.
     */
    yield* Reactivity.invalidate([roomThreadKey(roomId), decisionThreadKey(roomId), ROOMS_KEY])
  })
)

/**
 * Invalidate the channel list.
 *
 * Its own atom rather than folding it into the thread invalidation, because the two are triggered by different
 * frames and a channel being created should not refetch an open thread.
 */
export const invalidateRoomsAtom = Api.runtime.fn(
  Effect.fnUntraced(function*() {
    yield* Reactivity.invalidate([ROOMS_KEY])
  })
)

/**
 * Invalidate everything about decisions, from outside the atom graph.
 *
 * This is the socket's entry point into the data layer. It runs inside the `Api` runtime because that is what
 * provides `Reactivity` — the same service the queries registered their keys with, which is the whole reason
 * invalidating here re-runs them.
 */
export const invalidateDecisionsAtom = Api.runtime.fn(
  Effect.fnUntraced(function*() {
    yield* Reactivity.invalidate([DECISIONS_KEY])
  })
)
