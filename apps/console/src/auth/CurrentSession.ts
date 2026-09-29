/**
 * Who is asking, resolved ON THE SERVER before a route renders.
 *
 * This is why the console moved from a static SPA to TanStack Start. As an SPA the only options were to
 * render the authenticated shell and then correct it (a flicker, and briefly the wrong UI), or to block on
 * a client fetch (a spinner on every navigation). Neither is a guard: both send the page and decide after.
 *
 * **better-auth answers this, not us.** Two earlier versions of this file did it by hand: the first built
 * `new Request("https://api.internal/api/v1/me")` with an untyped JSON cast, the second went through
 * `HttpApiClient`. Both reimplemented `getSession`, which the client already provides and which knows
 * about cookie caching, session refresh and the organization plugin. The only thing left to supply here
 * is the transport.
 *
 * `/api/v1/me` is still the authority for ORGANIZATION and ROLE, which it reads from the `member` table.
 * This file answers the narrower question the guards actually ask: is anyone signed in.
 */
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { createAuthClient } from "better-auth/react"
import { env } from "cloudflare:workers"

interface ApiBinding {
  readonly fetch: (request: Request) => Promise<Response>
}

/**
 * A SECOND client for server-side use, differing from the browser's only in transport.
 *
 * `customFetchImpl` sends the request through the service binding — Worker to Worker inside Cloudflare, so
 * no public request, no DNS, no TLS, no egress. It also avoids the console fetching its OWN origin, which
 * would be a Worker subrequesting itself.
 *
 * `baseURL` is required to build an absolute URL but is never resolved: a service binding ignores the host.
 * It names the binding rather than impersonating a hostname, so nobody reads it as somewhere real.
 */
const serverAuthClient = createAuthClient({
  baseURL: "http://api.binding",
  basePath: "/api/auth",
  fetchOptions: {
    customFetchImpl: (input, init) =>
      (env as unknown as { readonly API: ApiBinding }).API.fetch(new Request(input as string, init))
  }
})

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
     * adds without this file changing. Naming `cookie` explicitly was the previous version's mistake: it
     * worked, and it quietly took over a decision that belongs to the library.
     */
    const { data } = await serverAuthClient.getSession({
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
