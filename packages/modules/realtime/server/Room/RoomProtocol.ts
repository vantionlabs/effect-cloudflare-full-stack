/**
 * What a room DOES, as plain functions over a structural socket.
 *
 * **Why this is not the Durable Object class.** A `DurableObject` subclass needs `cloudflare:workers` and
 * several runtime globals (`WebSocketPair`, `DurableObjectState`, `WebSocketRequestResponsePair`), and this
 * package deliberately compiles with `types: []` so that platform globals are not ambient — a server-ring
 * file that needs `R2Bucket` imports it by name, and most, like `R2Blobs` and `LanguageModelWorkersAi`,
 * describe what they need structurally instead. A class defined by a platform contract cannot follow that
 * rule, so the class stays in `apps/worker` where the deployment lives, and everything it decides lives here.
 *
 * The split is worth more than tidiness: a room's behaviour — who is present, who gets told, when a socket is
 * retired — is now testable in Node against three-line fakes, with no `workerd`, no token and no harness.
 * The class that remains is glue: it wires four handlers to these functions.
 */
import {
  decodeClientFrame,
  decodeRoomIdentity,
  encodeServerFrame,
  Presence,
  ROOM_IDENTITY_HEADER,
  Viewer,
  Welcome
} from "@ea/modules/realtime/domain/Room"
import { UserId } from "@ea/modules/shared/domain/Identity"
import { Result } from "effect"

/**
 * The part of a `WebSocket` a room uses.
 *
 * Structural, following `R2Blobs` next door: naming the platform's type would drag `@cloudflare/workers-types`
 * into a package that has no business knowing which cloud it is on, and a fake would then have to satisfy the
 * whole interface rather than the four methods that are actually called.
 */
export interface RoomSocket {
  readonly send: (message: string) => void
  readonly close: (code?: number, reason?: string) => void
  readonly serializeAttachment: (value: unknown) => void
  readonly deserializeAttachment: () => unknown
}

/**
 * What a socket carries about its owner, across hibernation.
 *
 * **Not a `Map` on the instance, and not Redis either.** Both are what this would be elsewhere, and both are
 * wrong here:
 *
 * *Not an in-memory map.* Cloudflare's own chat demo keeps a `sessions` array on the object, which is the
 * classic mistake once hibernation is in play: the room leaves memory between messages, so the map is empty on
 * the next wake and every viewer silently disappears. An attachment is stored with the socket, survives
 * hibernation while the connection is healthy, and is lost exactly when the connection is (16,384 bytes max).
 * So the viewer list is *derived*, every time. There is no cache to invalidate.
 *
 * *Not Redis.* In a fleet of stateless nodes a bus is needed because each node holds some sockets and no node
 * knows the others'. A Durable Object **is** that shared point, so there is nothing to synchronise with.
 * Removing the bus removes its failure mode too: a presence set needs TTL heartbeats because a crashed node
 * cannot delete its own entries, so it shows ghosts until they expire. Here a dead socket is simply not in the
 * set, and a ghost is not representable.
 *
 * **It holds no session token.** The upgrade authenticated the request and this is what is left of it; a token
 * here would be a credential sitting in platform storage for the life of a connection, for no gain — nothing
 * in a room re-checks a session.
 */
export interface Attachment {
  readonly userId: string
  readonly email: string
  readonly viewing: string | null
  /** When the socket was accepted, so a room can retire it. See `staleSockets`. */
  readonly since: number
}

/**
 * How long a socket may live before the room closes it and the client reconnects.
 *
 * The session cookie is checked **once**, at the upgrade. Without a bound, somebody who signs out — or whose
 * access is revoked — keeps receiving their organization's queue activity until they close the tab, because
 * nothing in a room ever looks at a cookie again. Reconnecting re-authenticates, so this is the interval at
 * which revocation actually takes effect.
 *
 * Thirty minutes is a judgement, not a derivation: long enough that a reconnect is rare, short enough that a
 * revoked session does not outlive a coffee break. It is enforced lazily, on the next frame the room handles,
 * because a timer would prevent hibernation — so a quiet room may hold a socket longer than this. That is the
 * right trade: an idle socket is receiving nothing.
 */
export const MAX_SOCKET_AGE_MS = 30 * 60 * 1000

/** Reads the identity the upgrade route put on the request, or `null` if it is absent or malformed. */
export const identityFromHeaders = (
  header: string | null
): { readonly userId: string; readonly email: string } | null => {
  const decoded = decodeRoomIdentity(header ?? "")
  return Result.isSuccess(decoded) ? { userId: decoded.success.userId, email: decoded.success.email } : null
}

export { ROOM_IDENTITY_HEADER }

/** The attachment a freshly accepted socket carries. */
export const attachmentFor = (
  identity: { readonly userId: string; readonly email: string },
  now: number
): Attachment => ({ userId: identity.userId, email: identity.email, viewing: null, since: now })

/**
 * The viewer list, derived from the attachments every time.
 *
 * `gone` drops a socket that is leaving: the platform still lists a socket whose close handler is running, so
 * a departure would otherwise announce the leaver as present.
 */
export const viewersOf = (
  sockets: Iterable<RoomSocket>,
  gone?: RoomSocket
): ReadonlyArray<Viewer> => {
  const viewers: Array<Viewer> = []
  for (const socket of sockets) {
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

/** The frame a joining socket receives: the whole list, so it is never missing from its own view. */
export const welcomeFor = (sockets: Iterable<RoomSocket>): string =>
  encodeServerFrame(new Welcome({ viewers: viewersOf(sockets) }))

/**
 * Send one encoded frame to everyone, minus the exclusions.
 *
 * **Two different exclusions, and conflating them was a bug the tests caught.** The first version took one
 * `except` socket and used it both to skip a recipient and to omit a viewer, so a joining socket was left out
 * of the list everybody else received: the second person to connect was invisible to the first until somebody
 * moved.
 *
 * - `gone` — leaving. Excluded from the list *and* from the recipients.
 * - `skip` — present, but does not need this frame. Excluded from the recipients only. A socket that has just
 *   been sent `Welcome` is exactly that case.
 */
export const announcePresence = (
  sockets: Iterable<RoomSocket>,
  options: { readonly gone?: RoomSocket; readonly skip?: RoomSocket } = {}
): void => {
  const encoded = encodeServerFrame(new Presence({ viewers: viewersOf(sockets, options.gone) }))
  broadcastTo(sockets, encoded, options)
}

/**
 * Send to every socket, tolerating one that is closing.
 *
 * Per-socket try/catch because the platform can list a socket in `CLOSING` — the docs say so explicitly — and
 * sending to it throws. Without this, the first person to close a tab silently costs everyone else the update.
 */
export const broadcastTo = (
  sockets: Iterable<RoomSocket>,
  encoded: string,
  options: { readonly gone?: RoomSocket; readonly skip?: RoomSocket } = {}
): void => {
  for (const socket of sockets) {
    if (socket === options.gone || socket === options.skip) continue
    try {
      socket.send(encoded)
    } catch {
      // Nothing to do and nothing to log: the close handler will remove it.
    }
  }
}

/**
 * Applies a client frame, returning whether presence changed.
 *
 * A frame that cannot be read is DROPPED rather than fatal. A room is shared, so throwing on one malformed
 * message would take down a connection — or, with the hibernation handlers, the invocation serving several —
 * because one client sent nonsense. The client is the untrusted end here.
 */
export const applyClientFrame = (socket: RoomSocket, message: string): boolean => {
  const decoded = decodeClientFrame(message)
  if (!Result.isSuccess(decoded)) return false

  const attachment = socket.deserializeAttachment() as Attachment | null
  if (attachment === null) return false
  socket.serializeAttachment({ ...attachment, viewing: decoded.success.decisionId } satisfies Attachment)
  return true
}

/** Sockets past `MAX_SOCKET_AGE_MS`, so revocation eventually bites. */
export const staleSockets = (sockets: Iterable<RoomSocket>, now: number): ReadonlyArray<RoomSocket> => {
  const stale: Array<RoomSocket> = []
  for (const socket of sockets) {
    const attachment = socket.deserializeAttachment() as Attachment | null
    if (attachment === null || now - attachment.since < MAX_SOCKET_AGE_MS) continue
    stale.push(socket)
  }
  return stale
}
