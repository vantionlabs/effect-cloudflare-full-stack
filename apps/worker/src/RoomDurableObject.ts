/**
 * The room, as the runtime requires it: a class extending `DurableObject`, exported from the Worker's entry.
 *
 * **Glue only.** Everything this decides lives in `@ea/modules/realtime/server/Room` as plain functions —
 * who is present, who gets told, when a socket is retired — and is unit-tested there against fakes with no
 * `workerd` involved. What is left here is the part that genuinely belongs to the deployment: the class
 * itself, the hibernation handlers, and the runtime globals.
 *
 * It is in `apps/worker` rather than in the module for one reason, and it is not a matter of taste. The class
 * must extend `DurableObject` from `cloudflare:workers` and use `WebSocketPair`, `DurableObjectState` and
 * `WebSocketRequestResponsePair`, and `packages/modules` compiles with `types: []` precisely so that platform
 * globals are not ambient there — its server-ring files describe what they need structurally instead
 * (`R2Blobs`, `LanguageModelWorkersAi`). A class defined by a platform contract cannot be structural about it.
 *
 * Two rules it must keep, both from ADR-0019:
 *
 * - **No database, ever.** An outbound `connect()` keeps a Durable Object resident and billable for up to 15
 *   minutes, and our Postgres client dials through `cloudflare:sockets` — so a room that wrote would stay
 *   billable for a quarter of an hour after every message. `dep:check` forbids the import.
 * - **Nothing in memory between events.** Hibernation is defined by losing it. Anything a socket must remember
 *   goes in its attachment.
 */
import {
  announcePresence,
  applyClientFrame,
  attachmentFor,
  broadcastTo,
  identityFromHeaders,
  ROOM_IDENTITY_HEADER,
  type RoomSocket,
  staleSockets,
  welcomeFor
} from "@ea/modules/realtime/server/Room"
// The keepalive pair comes from the DOMAIN, because both ends of the socket must agree on it.
import { PING, PONG } from "@ea/modules/realtime/domain/Room"
import { DurableObject } from "cloudflare:workers"

export class RoomDurableObject extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never)
    /*
     * Keepalive answered by the runtime, without waking this object.
     *
     * In the constructor because that is the only place it can go: a room is reconstructed on every wake, so
     * anything set "at startup" must be set here. Cloudflare's own best-practices page does the same.
     *
     * The client sends the bare string `ping`; the runtime replies `pong`. Cloudflare closes a socket that has
     * been silent both ways, and a browser cannot send a protocol ping, so without this a quiet room's
     * connections would simply die.
     */
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG))
  }

  /** The socket set, as the protocol functions want it. */
  private get sockets(): ReadonlyArray<RoomSocket> {
    return this.ctx.getWebSockets() as unknown as ReadonlyArray<RoomSocket>
  }

  /**
   * Accept a socket. The Worker has already authenticated the request.
   *
   * `fetch` rather than a typed RPC method, and not by choice: a `WebSocket` cannot cross a stub boundary
   * (`DataCloneError`, verified), so the pair has to be created in here — which means the room is entered with
   * a request and the identity rides one Schema-encoded header.
   */
  override async fetch(request: Request): Promise<Response> {
    const identity = identityFromHeaders(request.headers.get(ROOM_IDENTITY_HEADER))
    if (identity === null) {
      /*
       * 500, not 4xx. A request reaching a room without a valid identity header did not come from a client —
       * it came from our own Worker, wrongly — so there is nothing a caller could do differently.
       */
      return new Response("room reached without an authenticated identity", { status: 500 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket]

    /*
     * `acceptWebSocket`, NOT `server.accept()`. This is the whole cost model: `accept()` keeps the room in
     * memory for as long as the socket is open and bills wall-clock for every second of it.
     */
    this.ctx.acceptWebSocket(server)
    const socket = server as unknown as RoomSocket
    socket.serializeAttachment(attachmentFor(identity, Date.now()))

    // The joiner gets the whole list; everyone else gets a Presence that INCLUDES the joiner, hence `skip`.
    socket.send(welcomeFor(this.sockets))
    announcePresence(this.sockets, { skip: socket })

    return new Response(null, { status: 101, webSocket: client } as ResponseInit)
  }

  /**
   * Broadcast, called by the Worker over an RPC method on the stub.
   *
   * One RPC session is billed as one request however many sockets it reaches, which is why the Worker sends one
   * call per event rather than one per recipient.
   */
  async broadcast(encoded: string): Promise<void> {
    this.retireStale()
    broadcastTo(this.sockets, encoded)
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    this.retireStale()
    if (typeof message !== "string") return
    if (applyClientFrame(ws as unknown as RoomSocket, message)) announcePresence(this.sockets)
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    /*
     * No `ws.close()` call. With `web_socket_auto_reply_to_close` the runtime completes the handshake, and that
     * flag is default-on from compatibility date 2026-04-07 — ours is 2026-09-26. On an older date this would
     * be required to avoid 1006 abnormal closures.
     */
    announcePresence(this.sockets, { gone: ws as unknown as RoomSocket })
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    announcePresence(this.sockets, { gone: ws as unknown as RoomSocket })
  }

  /**
   * Close sockets past their maximum age, so a revoked session eventually stops receiving data.
   *
   * Called from the handlers rather than from an alarm: an alarm prevents hibernation, which would make every
   * room permanently resident — paying wall-clock for the privilege of enforcing a bound on connections that
   * are not receiving anything.
   */
  private retireStale(): void {
    for (const socket of staleSockets(this.sockets, Date.now())) {
      try {
        // 1012 "service restart": the client should reconnect, which re-authenticates it.
        socket.close(1012, "reauthenticate")
      } catch {
        // Already closing.
      }
    }
  }
}
