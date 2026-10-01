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
     * `http://api.binding` is a BASE FOR URL CONSTRUCTION, never a destination.
     *
     * better-auth builds paths like `/api/auth/get-session`, and `new URL()` needs some absolute base to
     * turn one into a URL. A service binding routes by BINDING, not by host: the hostname is never
     * resolved, never looked up in DNS, never used to pick a target. The name says what it is rather than
     * impersonating a real host, so nobody later reads it as somewhere that exists.
     *
     * **This is why it needs no per-environment value.** The binding is what varies, in wrangler.jsonc:
     *
     *     production   API -> effect-ai
     *     staging      API -> effect-ai-staging
     *     dev          API -> effect-ai-dev
     *
     * So the same literal reaches a different API in each environment, and the wiring is structural
     * rather than configured. There is no hostname to get wrong, and no way for staging's console to
     * reach production's API by a stale URL — the two failure modes a real base URL would introduce.
     *
     * **The one trap.** This path sends no `Origin` header, because a server-side fetch has no origin.
     * better-auth skips its CSRF check for GET, so `getSession` is fine — but a state-changing call made
     * through here WOULD be refused (`MISSING_OR_NULL_ORIGIN`), since cookies are forwarded and that is
     * what arms the check. Mutations therefore belong in the browser, where the real Origin is present and
     * the API's `ALLOWED_HOSTS` already names it. If a server-side mutation is ever genuinely needed, the
     * fix is an explicit trusted Origin here AND in `ALLOWED_HOSTS` — not disabling the check.
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
