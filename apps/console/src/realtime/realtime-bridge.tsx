/**
 * The one place where socket frames become application state.
 *
 * It renders nothing. Its whole job is to keep that translation out of the screens: the queue screen reads
 * atoms and never learns that a socket exists, and this file knows about frames but not about what a queue
 * looks like. Without it, every screen that wanted live data would grow its own `useServerFrame` and its own
 * idea of what to do with the result.
 *
 * Mounted once, under `<WebSocketProvider>`. Mounting it twice would double every effect a frame causes,
 * which for an invalidation is wasteful and for anything stateful would be a bug — so it lives in the
 * authenticated layout and nowhere else.
 */
import { useAtomSet } from "@effect/atom-react"
import { useIdentity } from "../hooks/use-session.ts"
import { invalidateDecisionsAtom, viewersAtom } from "./realtime-atoms.ts"
import { useServerFrame } from "./use-socket.ts"

export const RealtimeBridge = (): null => {
  const identity = useIdentity()
  const setViewers = useAtomSet(viewersAtom)
  const invalidateDecisions = useAtomSet(invalidateDecisionsAtom)

  useServerFrame("Welcome", (frame) => setViewers(frame.viewers))
  useServerFrame("Presence", (frame) => setViewers(frame.viewers))

  useServerFrame("QueueChanged", (frame) => {
    /*
     * Own echo ignored. The mutation that caused this already invalidated the same key on success, so
     * acting on it again would re-run the query for nothing — once per person in the room, all triggered by
     * one click.
     */
    if (frame.byUserId === identity.id) return
    invalidateDecisions()
  })

  return null
}
