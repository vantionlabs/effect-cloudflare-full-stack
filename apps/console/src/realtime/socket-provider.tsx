/**
 * The realtime transport, and nothing above it.
 *
 * **One connection per app.** That is the reason this is a provider rather than a hook: a hook that opened a
 * socket would open one per caller, so a queue screen and a notification bell would hold two connections to
 * the same room, each counting against the same request budget, each needing its own keepalive, and each
 * reconnecting separately after a deploy. The first version of this was exactly that hook.
 *
 * **It knows the wire, not the meaning.** This file decodes frames and hands them to whoever subscribed; it
 * has no idea what a viewer or a queue is. Presence lives in `use-presence.ts`, and anything else that grows
 * out of a frame lives with the screen that cares. The split is what keeps the socket's three genuinely
 * tricky concerns — keepalive, reconnect, and one connection — in one place that nothing else has to think
 * about.
 *
 * Three platform facts drive the implementation, all recorded in `docs/references.md`:
 *
 * - Cloudflare closes a socket that has been silent in both directions, and **a browser cannot send a
 *   protocol ping** — the `WebSocket` API has no `ping()`. So the client sends the bare string `ping`, and
 *   the room's `setWebSocketAutoResponse` answers it from the runtime *without waking the room*. The ping
 *   must stay a bare string: the auto-response matches exactly, and JSON would wake the room on every
 *   keepalive.
 * - **Reconnects are routine, not exceptional.** Cloudflare restarts servers on deploy, and the room itself
 *   closes sockets after thirty minutes so a revoked session stops receiving data.
 * - Backoff is **jittered** because a deploy disconnects every client in an organization at the same instant,
 *   and identical backoff would bring them all back in lockstep.
 */
import { decodeServerFrame, PING, PONG, REALTIME_PATH, type ServerFrame } from "@ea/modules/shared/domain/Room"
import { createContext, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"

const PING_INTERVAL_MS = 30_000
const RECONNECT_BASE_MS = 500
const RECONNECT_MAX_MS = 10_000

export type SocketStatus = "connecting" | "open" | "closed"

export interface SocketContextValue {
  readonly status: SocketStatus
  /**
   * Subscribe to every frame; returns an unsubscribe.
   *
   * Every frame rather than a filtered stream, because filtering is one line at the call site and a
   * per-tag registry here would be a second thing to keep in step with the union. `useServerFrame` is that
   * one line, typed.
   */
  readonly subscribe: (listener: (frame: ServerFrame) => void) => () => void
  /**
   * Send a client frame. Dropped if the socket is not open — deliberately, not queued.
   *
   * Everything a client sends over this socket is ephemeral per-connection state (see RoomFrame.ts), and
   * replaying "I am looking at X" on reconnect would announce a position the user has since left. Anything
   * that must not be dropped belongs on the RPC path, which is durable and has error handling.
   */
  readonly send: (frame: { readonly _tag: string } & Record<string, unknown>) => void
}

export const SocketContext = createContext<SocketContextValue | null>(null)

export const WebSocketProvider = ({
  children,
  enabled = true
}: {
  readonly children: ReactNode
  /**
   * `false` keeps the socket closed without unmounting consumers.
   *
   * Used for a session with no active organization: there is no room to join, and consumers still render.
   * A conditional `<WebSocketProvider>` in the tree would make `useSocket` throw instead, which is a worse
   * shape — it turns a legitimate state into a crash in an unrelated component.
   */
  readonly enabled?: boolean
}) => {
  const [status, setStatus] = useState<SocketStatus>(enabled ? "connecting" : "closed")
  const socket = useRef<WebSocket | null>(null)
  /*
   * Listeners in a ref, not state: adding one must not re-render the provider, which would re-render the
   * whole authenticated tree every time a screen mounted a subscription.
   */
  const listeners = useRef(new Set<(frame: ServerFrame) => void>())

  useEffect(() => {
    if (!enabled) {
      setStatus("closed")
      return
    }
    // Effects do not run during SSR, and the URL below needs an origin.
    if (typeof window === "undefined") return

    let disposed = false
    let attempt = 0
    let pingTimer: ReturnType<typeof setInterval> | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    const connect = () => {
      if (disposed) return
      setStatus("connecting")

      /*
       * Same origin as the page, which is also how it authenticates: a same-origin upgrade carries the
       * session cookie first-party, so there is no token in a query string and no second auth path.
       */
      const url = new URL(REALTIME_PATH, window.location.href)
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:"

      const ws = new WebSocket(url)
      socket.current = ws

      ws.addEventListener("open", () => {
        attempt = 0
        setStatus("open")
        pingTimer = setInterval(() => {
          // Checked because a timer can fire between a close and its handler running.
          if (ws.readyState === WebSocket.OPEN) ws.send(PING)
        }, PING_INTERVAL_MS)
      })

      ws.addEventListener("message", (event) => {
        if (typeof event.data !== "string" || event.data === PONG) return

        /*
         * A frame we cannot decode is dropped.
         *
         * The server is the trusted end, so this is version skew rather than validation: a deploy can leave
         * a tab open that predates a new frame type, and ignoring what it does not understand is better than
         * throwing inside an event listener, where nothing can catch it and the socket dies.
         */
        let frame: ServerFrame
        try {
          frame = decodeServerFrame(event.data)
        } catch {
          return
        }
        for (const listener of listeners.current) listener(frame)
      })

      ws.addEventListener("close", () => {
        if (pingTimer !== undefined) clearInterval(pingTimer)
        setStatus("closed")
        if (disposed) return
        const backoff = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS)
        attempt = attempt + 1
        retryTimer = setTimeout(connect, backoff * (0.5 + Math.random() / 2))
      })

      // `error` is always followed by `close`, so reconnecting is left to one handler.
      ws.addEventListener("error", () => setStatus("closed"))
    }

    connect()

    return () => {
      disposed = true
      if (pingTimer !== undefined) clearInterval(pingTimer)
      if (retryTimer !== undefined) clearTimeout(retryTimer)
      socket.current?.close()
      socket.current = null
    }
  }, [enabled])

  const subscribe = useCallback((listener: (frame: ServerFrame) => void) => {
    listeners.current.add(listener)
    return () => {
      listeners.current.delete(listener)
    }
  }, [])

  const send = useCallback((frame: { readonly _tag: string } & Record<string, unknown>) => {
    const ws = socket.current
    if (ws?.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify(frame))
  }, [])

  /*
   * Memoised on `status` alone, because `subscribe` and `send` are stable. Without this every status change
   * would give consumers a new context object and re-run their effects — including the subscription effects,
   * which would unsubscribe and resubscribe on each reconnect for no reason.
   */
  const value = useMemo<SocketContextValue>(() => ({ status, subscribe, send }), [status, subscribe, send])

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>
}
