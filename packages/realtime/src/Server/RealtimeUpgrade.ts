/**
 * The WebSocket upgrade: authenticate, then hand the request to the room.
 *
 * **Why this route is here and not in `packages/api`**, which is where every other transport edge lives:
 * it is irreducibly platform-specific. It needs the Durable Object binding, and it returns a `Response`
 * carrying a `webSocket` — an object no schema describes and which only `workerd` understands. The api
 * package is forbidden from importing bindings for good reasons (`dep:check`), and this would have to break
 * that rule to exist there.
 *
 * Two findings from the Effect source make it work at all, and both are easy to get wrong:
 *
 * - **`HttpServerResponse.raw(response)` passes a `Response` through untouched**, merging headers onto it.
 *   That is the only way a 101 with a `webSocket` survives the Effect router.
 * - **`HttpServerResponse.fromWeb(response)` would silently destroy it.** `fromWeb` copies status, headers
 *   and body-as-stream into a new response, and `webSocket` is none of those — so the client receives a 101
 *   with no socket attached and the connection fails with nothing in any log to explain it. `SessionHttp`
 *   next door uses `fromWeb` correctly, because better-auth returns an ordinary response; copying that line
 *   into here is the mistake this comment exists to prevent.
 */

import { IdentityResolver } from "@ea/domain/Identity"
import { Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { encodeRoomIdentity, orgRoom, REALTIME_PATH, ROOM_IDENTITY_HEADER, RoomIdentity } from "../Room/index.ts"
import type { RoomsBinding } from "./RoomsLive.ts"

/**
 * The route, taking the rooms binding as an argument.
 *
 * A function rather than a value because the binding is only known at composition time — `Main.ts` calls
 * `layer(env.ROOMS)`. That is what lets this file live in a module at all: it names the one capability it
 * uses, not the app's whole `Env`.
 */
export const RealtimeUpgrade = (rooms: RoomsBinding) =>
  HttpRouter.add(
    "GET",
    REALTIME_PATH,
    Effect.gen(function*() {
      const request = yield* HttpServerRequest.HttpServerRequest
      const webRequest = yield* HttpServerRequest.toWeb(request)

      /*
       * Refused before the session is even looked at. A GET to this path from a browser address bar is not an
       * upgrade, and 426 is the status that says so — the same check Cloudflare's own examples open with.
       */
      if (webRequest.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return HttpServerResponse.text("expected a websocket upgrade", { status: 426 })
      }

      /*
       * The session, from the cookie on the upgrade request.
       *
       * An upgrade is an ordinary HTTP request, so it carries cookies first-party — which is the dividend of
       * the console and the API sharing one origin (ADR-0001). There is no token in a query parameter and no
       * second auth path to keep in step.
       *
       * Checked ONCE, here. The room cannot re-check it, having no database, which is why sockets are retired
       * after a bounded lifetime — see MAX_SOCKET_AGE_MS in RoomDurableObject.ts.
       */
      const resolver = yield* IdentityResolver
      const identity = yield* resolver.fromHeaders(request.headers as Record<string, string>)
      if (identity === null) {
        /*
         * 401 and not a redirect. A WebSocket client cannot follow one — the browser surfaces a failed
         * upgrade, never a navigation — so the console's guard is what sends somebody to the login page, and
         * this is only how the socket says no.
         */
        return HttpServerResponse.text("not authenticated", { status: 401 })
      }

      /*
       * The room name is DERIVED, never received. A client asks for "realtime" and gets its own
       * organization's room; there is no parameter through which it could ask for another's. See RoomName.ts.
       */
      const room = orgRoom(identity.orgId)

      /*
       * The identity travels as ONE Schema-encoded header, and the header is REBUILT rather than appended to.
       *
       * `new Request(webRequest, { headers })` replaces the header set wholesale, so a client that sent its own
       * `x-room-identity` cannot have it survive — it is overwritten by what the session says. That ordering is
       * the only reason a header is acceptable here at all.
       *
       * A typed RPC method would be nicer and is not possible: a `WebSocket` cannot cross a stub boundary
       * (`DataCloneError`), so the room must create the pair itself and must therefore be entered with a
       * request. See `ROOM_IDENTITY_HEADER` for the alternatives that were tried.
       */
      const headers = new Headers(webRequest.headers)
      headers.set(
        ROOM_IDENTITY_HEADER,
        encodeRoomIdentity(new RoomIdentity({ userId: identity.userId, email: identity.email }))
      )

      const response = yield* Effect.promise(() => rooms.getByName(room).fetch(new Request(webRequest, { headers })))

      /*
       * `raw`, so the `Response` reaches the client untouched — `fromWeb` would copy status, headers and body
       * into a new response and silently drop `webSocket`, which is a 101 that never becomes a socket.
       */
      return HttpServerResponse.raw(response, { status: response.status })
    })
  )
