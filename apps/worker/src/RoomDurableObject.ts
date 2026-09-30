/**
 * A room: fan-out to everyone connected, and nothing else.
 *
 * **It stores nothing and holds no Effect runtime.** Both are deliberate, and both are the same decision
 * seen twice (ADR-0018, ADR-0019):
 *
 * - **No storage.** Postgres is the record. A room's SQLite would be a second copy of the same history with
 *   its own eviction rule, and the failure mode is a reconnecting client disagreeing with a reloading one.
 *   It still declares `storage: "sqlite"` in wrangler.jsonc because that is the only backend available to a
 *   new namespace; it simply never opens it.
 * - **No database, ever.** An outbound `connect()` keeps a Durable Object resident and billable for up to 15
 *   minutes per connection, and our Postgres client dials through `cloudflare:sockets`. A room that wrote to
 *   the database would therefore stay billable for a quarter of an hour after every message, which is the
 *   difference between Cloudflare's $20/month worked example and their $412/month one. `dep:check` forbids
 *   the import so this cannot be undone by accident.
 *
 * So there is no Effect layer in here. It would be honest — the code is trivially effectful — but a layer
 * graph is per-instance state, a room may be reconstructed on any wake, and the thing it would most want to
 * provide is a database connection it must not have. Plain `async` methods over web-standard APIs are the
 * smaller surface, and the Schema codecs come from the domain ring either way.
 */
import { UserId } from "@ea/modules/shared/domain/Identity"
import {
  decodeClientFrame,
  decodeRoomIdentity,
  encodeServerFrame,
  PING,
  PONG,
  Presence,
  ROOM_IDENTITY_HEADER,
  Viewer,
  Welcome
} from "@ea/modules/shared/domain/Room"
import { DurableObject } from "cloudflare:workers"
import { Result } from "effect"

/**
 * What a socket carries about its owner, across hibernation.
 *
 * **Not a `Map` on `this`, and not Redis either.** Both are worth explaining, because both are what this
 * would be in another architecture.
 *
 * *Why not an in-memory map.* Cloudflare's own chat demo keeps a `sessions` array on the instance, and that
 * is the classic mistake once hibernation is in play: the room leaves memory between messages, so the map is
 * empty on the next wake and every viewer silently disappears. `serializeAttachment` is the platform's
 * answer — the value is stored with the socket, survives hibernation for as long as the connection is
 * healthy, and is lost exactly when the connection is (16,384 bytes max, structured-clone types). So the
 * viewer list is *derived*, every time, from `getWebSockets()` plus these attachments. There is no cache to
 * invalidate and no copy to go stale.
 *
 * *Why not Redis, or a pub/sub bus.* In a fleet of stateless nodes you need one, because each node holds
 * some sockets and no node knows the others': the bus is how a message reaches connections attached
 * elsewhere, and a presence set is how you answer "who is online" across the fleet. **A Durable Object is
 * that shared point** — every socket for one organization terminates in this one object, so there are no
 * other nodes to synchronise with. Removing the bus also removes its failure mode: a presence set in Redis
 * needs TTL heartbeats because a crashed node cannot delete its own entries, so the UI shows ghosts until a
 * timeout expires. Here a dead socket is simply not returned by `getWebSockets()`, and a ghost is not
 * representable.
 *
 * What we pay for that is in ADR-0018: one coordination point per organization, with a throughput ceiling
 * (~500–1,000 requests per second) and a fixed location chosen on first connect.
 *
 * **It holds no session token.** The upgrade authenticated the request and this is what is left of it; a
 * token here would be a credential sitting in platform storage for the life of a connection for no gain —
 * nothing in a room re-checks a session.
 */
interface Attachment {
  readonly userId: string
  readonly email: string
  readonly viewing: string | null
  /** When the socket was accepted, so a room can retire it. See `MAX_SOCKET_AGE_MS`. */
  readonly since: number
}

/**
 * How long a socket may live before the room closes it and the client reconnects.
 *
 * The session cookie is checked **once**, at the upgrade. Without a bound, somebody who signs out — or whose
 * access is revoked — keeps receiving their organization's queue activity until they close the tab, because
 * nothing in the room ever looks at a cookie again. Reconnecting re-authenticates, so this is the interval
 * at which revocation actually takes effect.
 *
 * Thirty minutes is a judgement, not a derivation: long enough that a reconnect is rare and cheap, short
 * enough that a revoked session does not outlive a coffee break. It is enforced lazily, on the next frame
 * the room handles, because a timer would prevent hibernation — which is why a quiet room may hold a socket
 * slightly longer than this. That is the right trade: an idle socket is receiving nothing.
 */
const MAX_SOCKET_AGE_MS = 30 * 60 * 1000

export class RoomDurableObject extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never)
    /*
     * Keepalive answered by the runtime, without waking this object.
     *
     * In the constructor because that is the only place it can go: a room is reconstructed on any wake, so
     * anything set once "at startup" must be set here. Cloudflare's own best-practices page does the same.
     *
     * The client sends the bare string `ping` on a timer; the runtime replies `pong`. Cloudflare closes a
     * WebSocket that has been silent in both directions, and a browser cannot send a protocol ping, so
     * without this a quiet room's connections would simply die (`docs/references.md`).
     */
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG))
  }

  /**
   * Accept a socket. The Worker has already authenticated the request.
   *
   * `fetch` rather than a typed RPC method, and not by choice: a `WebSocket` cannot cross a stub boundary
   * (`DataCloneError`, verified — see `ROOM_IDENTITY_HEADER`), so the pair has to be created in here, which
   * means the room is entered through `fetch` and the identity has to ride the request. It arrives as one
   * Schema-encoded header rather than as loose strings, so a malformed one fails here with a decode error
   * instead of becoming two silent nulls.
   *
   * The room does not verify it and cannot: it has no database. The guarantee is that a Durable Object
   * namespace is reachable only from a Worker in this account, and the one route that reaches this namespace
   * resolves a session first and overwrites this header from it.
   */
  override async fetch(request: Request): Promise<Response> {
    const decoded = decodeRoomIdentity(request.headers.get(ROOM_IDENTITY_HEADER) ?? "")
    if (!Result.isSuccess(decoded)) {
      /*
       * 500, not 4xx. A request reaching a room without a valid identity header did not come from a client —
       * it came from our own Worker, wrongly — so there is nothing a caller could do differently. It is a bug
       * report, not a refusal.
       */
      return new Response("room reached without an authenticated identity", { status: 500 })
    }
    const identity = decoded.success

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket]

    /*
     * `acceptWebSocket`, NOT `server.accept()`.
     *
     * This is the whole cost model. `accept()` keeps the room in memory for as long as the socket is open and
     * bills wall-clock for every second of it; `acceptWebSocket` lets the room hibernate while the socket
     * stays connected, and delivery arrives through the `webSocket*` handlers below.
     */
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment(
      { userId: identity.userId, email: identity.email, viewing: null, since: Date.now() } satisfies Attachment
    )

    /*
     * The new socket gets the whole list; everyone else gets a `Presence` that INCLUDES the new socket —
     * hence `skip` rather than `gone`. Sending `Welcome` before announcing also means the joiner never
     * receives a list it is missing from.
     */
    server.send(encodeServerFrame(new Welcome({ viewers: this.viewers() })))
    this.announcePresence({ skip: server })

    return new Response(null, { status: 101, webSocket: client } as ResponseInit)
  }

  /**
   * Broadcast, called by the Worker over an RPC method on the stub.
   *
   * One RPC session is billed as one request regardless of how many sockets it fans out to, which is why
   * the Worker sends one call per event rather than one per recipient.
   */
  async broadcast(encoded: string): Promise<void> {
    this.retireStaleSockets()
    for (const socket of this.ctx.getWebSockets()) {
      /*
       * Per-socket try/catch: one closing socket must not stop the others being told.
       *
       * `getWebSockets` can return a socket in `CLOSING` — the docs say so explicitly — and sending to it
       * throws. Without this, the first person to close a tab silently costs everyone else the update.
       */
      try {
        socket.send(encoded)
      } catch {
        // Nothing to do and nothing to log: the close handler will remove it.
      }
    }
  }

  /** Client → server frames. The only ones that exist are ephemeral; see RoomFrame.ts. */
  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    this.retireStaleSockets()
    if (typeof message !== "string") return

    const decoded = decodeClientFrame(message)
    /*
     * A frame we cannot read is dropped, not fatal.
     *
     * A room is shared: throwing on one malformed message would take down a connection — or, with the
     * hibernation handlers, potentially the invocation serving several — because one client sent nonsense.
     * The client is the untrusted end here.
     *
     * `Result.isSuccess` to narrow, because `success` lives on the Success member rather than on the union
     * — reading `decoded.success` directly is a type error, which is the good kind of correction.
     */
    if (!Result.isSuccess(decoded)) return

    const attachment = ws.deserializeAttachment() as Attachment | null
    if (attachment === null) return
    ws.serializeAttachment({ ...attachment, viewing: decoded.success.decisionId } satisfies Attachment)
    this.announcePresence()
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    /*
     * No `ws.close()` call. With `web_socket_auto_reply_to_close` the runtime completes the handshake, and
     * that flag is default-on for compatibility dates from 2026-04-07 — ours is 2026-09-26. On an older
     * date this would be required to avoid 1006 abnormal closures.
     */
    this.announcePresence({ gone: ws })
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.announcePresence({ gone: ws })
  }

  /**
   * The viewer list, derived from the attachments every time.
   *
   * `gone` drops a socket that is leaving: `getWebSockets()` still returns a socket whose close handler is
   * running, so a departure would otherwise announce the leaver as present.
   */
  private viewers(gone?: WebSocket): ReadonlyArray<Viewer> {
    const viewers: Array<Viewer> = []
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === gone) continue
      const attachment = socket.deserializeAttachment() as Attachment | null
      if (attachment === null) continue
      viewers.push(
        new Viewer({
          userId: UserId.make(attachment.userId),
          email: attachment.email,
          viewing: attachment.viewing
        })
      )
    }
    return viewers
  }

  /**
   * Tell the room who is here.
   *
   * **Two different exclusions, and conflating them was a bug the tests caught.** The first version took one
   * `except` socket and used it both to skip a recipient and to omit a viewer, so a joining socket was left
   * out of the list that everybody else received: the second person to connect was invisible to the first
   * until somebody moved.
   *
   * - `gone` — leaving. Excluded from the list *and* from the recipients.
   * - `skip` — present, but does not need this frame. Excluded from the recipients only. A socket that has
   *   just been sent `Welcome` is the case: it already has the list.
   */
  private announcePresence(options: { readonly gone?: WebSocket; readonly skip?: WebSocket } = {}): void {
    const encoded = encodeServerFrame(new Presence({ viewers: this.viewers(options.gone) }))
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === options.gone || socket === options.skip) continue
      try {
        socket.send(encoded)
      } catch {
        // See `broadcast`: a socket can be CLOSING, and one of those must not stop the others being told.
      }
    }
  }

  /**
   * Close sockets older than `MAX_SOCKET_AGE_MS`, so revocation eventually bites.
   *
   * Called from the handlers rather than from an alarm, because an alarm prevents hibernation and would
   * make every room permanently resident — paying wall-clock for the privilege of enforcing a bound on
   * connections that are not receiving anything.
   */
  private retireStaleSockets(): void {
    const now = Date.now()
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as Attachment | null
      if (attachment === null || now - attachment.since < MAX_SOCKET_AGE_MS) continue
      try {
        // 1012 "service restart": the client should reconnect, which re-authenticates it.
        socket.close(1012, "reauthenticate")
      } catch {
        // Already closing.
      }
    }
  }
}
