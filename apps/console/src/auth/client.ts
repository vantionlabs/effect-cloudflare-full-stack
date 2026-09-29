/**
 * ONE better-auth client, used from the browser and from SSR.
 *
 * An earlier version had two — a relative one for the browser and a second with `customFetchImpl` for the
 * server — which meant two configurations to keep in step, and two places a plugin would have to be
 * registered. The only real difference between them was the transport, so that is the only thing that
 * varies now.
 *
 * **Why the transport has to vary at all.** In the browser a relative request is same-origin, and
 * `src/server.ts` forwards `/api/*` to the API over the service binding — so the cookie is first-party and
 * none of ADR-0001's three cross-origin settings are needed. During SSR there is no origin to be relative
 * to, and fetching our own public hostname would be a Worker subrequesting itself; the binding is both
 * faster and the only correct answer.
 *
 * `createIsomorphicFn` is Start's own primitive for this, so the server branch is stripped from the client
 * bundle rather than shipped and skipped at runtime.
 *
 * No `baseURL`: requests stay relative, which is what makes them same-origin in the browser by
 * construction. The server branch absolutises internally, where the fake host is never resolved because a
 * service binding ignores it.
 */
import { createIsomorphicFn } from "@tanstack/react-start"
import { organizationClient } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"

interface ApiBinding {
  readonly fetch: (request: Request) => Promise<Response>
}

const isomorphicFetch = createIsomorphicFn()
  .client((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init))
  .server(async (input: RequestInfo | URL, init?: RequestInit) => {
    /*
     * Imported inside the server branch, not at module scope: `cloudflare:workers` does not exist in the
     * browser, and a top-level import would put it in the client module graph even though the branch that
     * uses it is stripped.
     */
    const { env } = await import("cloudflare:workers")
    /*
     * `http://api.binding` is a base for URL construction, never a destination. A service binding routes
     * by binding, not by host, so this string is never resolved — it is named after what it is rather than
     * impersonating a real hostname, so nobody later mistakes it for one.
     */
    const url = new URL(String(input), "http://api.binding")
    return (env as unknown as { readonly API: ApiBinding }).API.fetch(new Request(url, init))
  })

export const authClient = createAuthClient({
  basePath: "/api/auth",
  fetchOptions: { customFetchImpl: isomorphicFetch as never },
  /*
   * The client half of the server's `organization` plugin, and it must match.
   *
   * A server plugin adds endpoints; its client counterpart adds the typed methods that call them. Without
   * this the console can authenticate but cannot create an organization or set the active one — and since
   * `resolveIdentity` refuses a session that cannot name a tenant, "signed in with no active org" is a
   * state that 401s on everything. The server declares `organization()`; this is the other end of it.
   */
  plugins: [organizationClient()]
})
