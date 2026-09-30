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
import { invalidateDecisionsAtom, invalidateThreadAtom, viewersAtom } from "./realtime-atoms.ts"
import { useServerFrame } from "./use-socket.ts"

export const RealtimeBridge = (): null => {
  const identity = useIdentity()
  const setViewers = useAtomSet(viewersAtom)
  const invalidateDecisions = useAtomSet(invalidateDecisionsAtom)
  const invalidateThread = useAtomSet(invalidateThreadAtom)

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

  useServerFrame("MessagePosted", (frame) => {
    /*
     * INVALIDATE rather than append, even though the frame carries the whole message.
     *
     * Appending would be one fewer round trip and a second way for messages to arrive: a client that appended
     * a live message and then refetched could show it twice, and one that appended while a refetch was in
     * flight could show it out of order. Re-reading keeps the thread's contents coming from exactly one place,
     * which is the same rule the queue follows. The frame carries the message so that a future optimistic
     * render has it; nothing needs it yet.
     *
     * Own echo included on purpose, unlike the queue: posting does not invalidate locally, so this is how the
     * poster's own thread updates. One refetch either way.
     */
    if (frame.message.subject.kind !== "decision") return
    invalidateThread(frame.message.subject.id)
  })

  return null
}
