/**
 * The Worker's entry: forward `/api/*` to the API, render everything else with TanStack Start.
 *
 * This is the Pages Function restored on a Worker, and it is what keeps the console ONE ORIGIN. That
 * property is load-bearing for two things that would otherwise each need their own workaround:
 *
 * 1. **better-auth's client SDK works unmodified.** It posts to `/api/auth/*` and relies on the browser
 *    sending and storing cookies first-party. Without a same-origin path the console would have to
 *    reimplement sign-in as server functions that relay `Set-Cookie` by hand — which is a worse copy of
 *    a library that already handles CSRF, error codes, verification and social providers.
 * 2. **The existing RPC client keeps working.** `src/rpc.ts` points at a relative `RPC_V1_PATH` and is
 *    typed from the server's own `RpcV1` group. A cross-origin console would need CORS with credentials,
 *    a trusted-origins list and a cookie `Domain` — ADR-0001's three coupled settings.
 *
 * Replacing the default entry is the documented extension point: Start's own
 * `@tanstack/react-start/server-entry` is exactly `createStartHandler(defaultStreamHandler)` wrapped in
 * an object with a `fetch`. This adds one branch in front of it and nothing else.
 *
 * The request is forwarded VERBATIM. A service binding's `fetch` takes a real `Request`, so the API sees
 * the original method, headers, body and URL — which is what makes the session cookie land on the host
 * the browser actually visited. Rebuilding the request would also drop the body on anything but `GET`,
 * and an upload is a `POST` of raw bytes: the failure would not be an error but an empty document that
 * parses to an empty string and extracts nothing.
 */
import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server"
import { env } from "cloudflare:workers"

const renderWithStart = createStartHandler(defaultStreamHandler)

interface ApiBinding {
  readonly fetch: (request: Request) => Promise<Response>
}

export default {
  fetch(request: Request, ...rest: ReadonlyArray<unknown>): Promise<Response> {
    const { pathname } = new URL(request.url)
    /*
     * `/api/` covers both `/api/auth/*` (better-auth) and `/api/v1/*` (the RPC and HTTP surface). One
     * prefix rather than two branches, because the API owns everything under it and the console should
     * not be deciding which of the API's routes exist.
     */
    if (pathname.startsWith("/api/")) {
      return (env as unknown as { readonly API: ApiBinding }).API.fetch(request)
    }
    // `Promise.resolve`: Start's handler is typed `Response | Promise<Response>`, and a Worker's
    // fetch must return a Promise.
    return Promise.resolve(renderWithStart(request, ...(rest as [])))
  }
}
