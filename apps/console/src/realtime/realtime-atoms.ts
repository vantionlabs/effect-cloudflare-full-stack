/**
 * Realtime state that belongs to the app rather than to a screen.
 *
 * In atoms rather than React context so that a component reading presence re-renders when presence changes
 * and at no other time. Context would re-render every consumer of the socket on every frame, which is the
 * thing the provider's `useMemo` is already careful to avoid for connection status.
 */
import type { Viewer } from "@ea/modules/shared/domain/Room"
import { Effect } from "effect"
import { Atom, Reactivity } from "effect/reactivity"
import { DECISIONS_KEY } from "../queue-atoms.ts"
import { Api } from "../rpc.ts"

/**
 * Everyone connected to this organization's room, including you.
 *
 * Written only by `realtime-bridge.tsx`, from `Welcome` and `Presence` frames. Both frames carry the whole
 * list, so both replace it — a delta protocol would be smaller and would require the client to stay in step
 * with a sequence number, for a list of a handful of names.
 */
export const viewersAtom = Atom.make<ReadonlyArray<Viewer>>([])

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
