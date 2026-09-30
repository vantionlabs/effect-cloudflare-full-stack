/**
 * Who else is in the room, and telling it where you are.
 *
 * Thin on purpose: the frames are handled in `realtime-bridge.tsx` and the list lives in an atom, so this is
 * the read side plus one writer. An earlier version kept the viewer list in `useState` here and cleared it
 * during render when the socket dropped — a render-phase `setState`, which is a re-render loop waiting for a
 * second caller. Deriving `connected` from status and holding the list in an atom removes the state that made
 * that tempting.
 */
import type { Viewer } from "@ea/realtime/Presence"
import { useAtomValue } from "@effect/atom-react"
import { useCallback } from "react"
import { viewersAtom } from "./realtime-atoms.ts"
import { useSocket } from "./use-socket.ts"

export interface Presence {
  /** Everyone connected, including you. */
  readonly viewers: ReadonlyArray<Viewer>
  readonly connected: boolean
  /**
   * Tell the room what you have open, or `null` for nothing.
   *
   * An opaque string to the transport: presence lives in `@ea/realtime`, which cannot know whether this is a
   * decision id or a room id (ADR-0021). The caller decides what it means; the room only echoes it.
   */
  readonly setViewing: (viewing: string | null) => void
}

export const usePresence = (): Presence => {
  const { send, status } = useSocket()
  const viewers = useAtomValue(viewersAtom)

  const setViewing = useCallback(
    (viewing: string | null) => send({ _tag: "Viewing", viewing }),
    [send]
  )

  return { viewers, connected: status === "open", setViewing }
}
