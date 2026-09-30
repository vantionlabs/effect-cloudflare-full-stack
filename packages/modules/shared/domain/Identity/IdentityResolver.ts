/**
 * Resolving who is calling, as a port.
 *
 * `Authenticated` next door is the HTTP middleware's seam and `AuthenticatedRpc` is the RPC one; both are
 * shaped for a *handler*, which is the wrong shape for anything that needs the answer without being one. The
 * WebSocket upgrade is the first such caller: it must authenticate before a room accepts a socket, and it
 * produces a 101 rather than a handler's response.
 *
 * **In `shared/domain` rather than in `iam`, deliberately**, and the reason is the layout rather than
 * convenience. A slice may not import another slice — they compose through `shared` — so a port declared in
 * `iam/domain` would be unreachable from `realtime/server`, and importing `iam/server` to get the
 * implementation is exactly what `dep:check` forbids. `CurrentUser` already lives here for the same reason:
 * "who is the caller" is everybody's concern and nobody's slice.
 *
 * Headers arrive as a plain record, not as a `Headers` instance. Effect's own `HttpServerRequest.headers` is
 * a record, and this ring compiles with `types: []` so a platform global would not resolve here anyway —
 * which is the point: the port stays runnable in Node, in the browser, and in a test with an object literal.
 */
import { Context, type Effect } from "effect"
import type { Identity } from "./Identity.ts"

export interface IdentityResolverService {
  /**
   * The caller, or `null` when there is no usable session.
   *
   * `null` rather than a failure: "nobody is signed in" is an answer, and every caller has to handle it.
   * What counts as unusable is the implementation's business — `iam` refuses a session with no active
   * organization, because a request that cannot name a tenant must not proceed (ADR-0014).
   */
  readonly fromHeaders: (headers: Record<string, string>) => Effect.Effect<Identity | null>
}

export class IdentityResolver extends Context.Service<IdentityResolver, IdentityResolverService>()(
  "shared/IdentityResolver"
) {}
