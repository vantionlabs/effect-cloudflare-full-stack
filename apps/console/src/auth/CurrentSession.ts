/**
 * Who is asking, resolved ON THE SERVER before a route renders.
 *
 * This is why the console moved from a static SPA to TanStack Start. As an SPA the only options were to
 * render the authenticated shell and then correct it (a flicker, and briefly the wrong UI), or to block on
 * a client fetch (a spinner on every navigation). Neither is a guard: both send the page and decide after.
 *
 * **better-auth answers this, not us.** Two earlier versions did it by hand — one built
 * `new Request("https://api.internal/api/v1/me")` with an untyped cast, the next went through
 * `HttpApiClient` — and both reimplemented `getSession`, which already knows about cookie caching, session
 * refresh and the organization plugin. This file now only forwards headers and tags the result.
 *
 * `/api/v1/me` remains the authority for ORGANIZATION and ROLE, which it reads from the `member` table.
 * The guards ask a narrower question: is anyone signed in.
 */
import { authClient } from "@/auth/client"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"

/**
 * Deliberately a discriminated union rather than `session | null`.
 *
 * `null` invites `session?.user.email` and a component that renders an empty string for a signed-out user
 * instead of refusing to render at all. A tag forces the caller to say which case it is handling — the same
 * reason the decision `Outcome` is a closed enum.
 */
export type CurrentSession =
  | {
    readonly _tag: "Authenticated"
    readonly user: { readonly id: string; readonly email: string; readonly name: string }
  }
  | { readonly _tag: "Guest" }

export const getCurrentSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<CurrentSession> => {
    /*
     * The request's whole headers are forwarded, not a hand-picked cookie.
     *
     * better-auth decides what it needs from them — the session cookie today, and whatever a future plugin
     * adds without this file changing. Naming `cookie` explicitly was an earlier version's mistake: it
     * worked, and it quietly took over a decision belonging to the library.
     *
     * The client is the SAME one the browser uses; only its transport differs, which `client.ts` handles
     * with an isomorphic fetch. So there is one configuration, one plugin list, one place to change.
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
      user: { id: data.user.id, email: data.user.email, name: data.user.name }
    }
  }
)
