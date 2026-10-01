/**
 * Who is asking, resolved ON THE SERVER before a route renders.
 *
 * This is why the console moved from a static SPA to TanStack Start. As an SPA the only options were to
 * render the authenticated shell and then correct it (a flicker, and briefly the wrong UI), or to block on
 * a client fetch (a spinner on every navigation). Neither is a guard: both send the page and decide after.
 *
 * better-auth's `getSession` answers it. Earlier versions of this file hand-built a request to
 * `/api/v1/me` and cast the JSON; that reimplemented a method which already knows about cookie caching,
 * session refresh and the organization plugin.
 */
import { authClient } from "@/features/auth/api/auth-client"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"

/**
 * better-auth's own inferred session type, which is the point.
 *
 * `$Infer` is derived from the client's configuration INCLUDING its plugins, so `activeOrganizationId`
 * below exists because `organizationClient()` is registered — nobody wrote that field down. A rename
 * upstream, or a plugin added or removed, becomes a compile error here instead of an `undefined` at
 * runtime. That is the same argument the RPC layer makes for sharing a contract rather than restating one.
 */
type BetterAuthSession = typeof authClient.$Infer.Session

/**
 * A PROJECTION of that type, not the whole thing — and the narrowing is a security boundary.
 *
 * `BetterAuthSession["session"]` contains `token`. This value goes into router context, and router context
 * is serialised into the SSR payload and shipped to the browser. Spreading the session would therefore
 * print the session token into the HTML — defeating the `HttpOnly` cookie whose entire purpose is that
 * JavaScript cannot read it. `Pick` is what keeps that from happening by accident, and it is why this is a
 * hand-listed projection of a derived type rather than the derived type itself.
 *
 * Also deliberately a tagged union rather than `session | null`: `null` invites `session?.user.email` and
 * a component that renders an empty string for a signed-out user instead of refusing to render at all.
 */
export type CurrentSession =
  | {
    readonly _tag: "Authenticated"
    readonly user: Pick<BetterAuthSession["user"], "id" | "email" | "name" | "image">
    /**
     * The active organization, from the organization plugin.
     *
     * Optional because a session can exist before one is set, which is a real state: the API's
     * `resolveIdentity` refuses such a session, so the console showing it as "signed in with nothing to
     * review" is more honest than pretending the tenant is known.
     */
    readonly organizationId: BetterAuthSession["session"]["activeOrganizationId"]
  }
  | { readonly _tag: "Guest" }

export const getCurrentSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<CurrentSession> => {
    /*
     * The request's whole headers are forwarded, not a hand-picked cookie.
     *
     * better-auth decides what it needs from them — the session cookie today, and whatever a future plugin
     * adds without this file changing. Naming `cookie` explicitly was an earlier version's mistake: it
     * worked, and quietly took over a decision belonging to the library.
     *
     * The client is the SAME one the browser uses; only the transport differs, which `auth-client.ts`
     * handles with an isomorphic fetch. One configuration, one plugin list, one place to change.
     */
    const { data } = await authClient.getSession({
      fetchOptions: { headers: getRequest().headers }
    })

    /*
     * No session is an ANSWER, not an error, which is what Guest encodes. Failing closed is deliberate: a
     * console that shows a login page when it cannot tell is safe; one that shows the authenticated shell
     * to a stranger is not.
     */
    if (data === null || data === undefined) return { _tag: "Guest" }

    return {
      _tag: "Authenticated",
      // Field by field, so adding one is a decision rather than a consequence of upstream adding it.
      user: {
        id: data.user.id,
        email: data.user.email,
        name: data.user.name,
        image: data.user.image
      },
      organizationId: data.session.activeOrganizationId
    }
  }
)
