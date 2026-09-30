/**
 * Reading the socket: the connection, and typed subscriptions to it.
 *
 * Separate from the provider so that the provider is a component and this is the API. A screen never touches
 * a `WebSocket`; it asks for the frames it cares about.
 */
import type { ServerFrame } from "@ea/modules/realtime/domain/Room"
import { useContext, useEffect, useRef } from "react"
import { SocketContext, type SocketContextValue } from "./socket-provider.tsx"

/**
 * The socket's context. Throws outside a `WebSocketProvider`.
 *
 * Throwing rather than returning a null-shaped stub: a component that silently never receives a frame is a
 * bug that looks like a quiet network, and it would be found in production rather than on the first render.
 */
export const useSocket = (): SocketContextValue => {
  const context = useContext(SocketContext)
  if (context === null) {
    throw new Error("useSocket() requires a <WebSocketProvider> above it")
  }
  return context
}

/**
 * Subscribe to one kind of frame, with the payload narrowed to that tag.
 *
 * The handler goes through a ref so that an inline arrow — which is every call site — does not resubscribe
 * on every render. That matters more than it looks: resubscribing is cheap, but the effect would also re-run
 * on each parent render, and a handler captured one render stale is the classic way a live update applies to
 * the wrong state.
 */
export const useServerFrame = <T extends ServerFrame["_tag"]>(
  tag: T,
  handler: (frame: Extract<ServerFrame, { readonly _tag: T }>) => void
): void => {
  const { subscribe } = useSocket()
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(
    () =>
      subscribe((frame) => {
        if (frame._tag !== tag) return
        handlerRef.current(frame as Extract<ServerFrame, { readonly _tag: T }>)
      }),
    [subscribe, tag]
  )
}
