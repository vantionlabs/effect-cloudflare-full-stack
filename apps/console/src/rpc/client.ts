/**
 * The console's data layer: the server's own RPC group, bound to atoms.
 *
 * `AtomRpc.Service` takes `RpcV1` — the **same value** the server types its handlers against — so a field
 * renamed on the server is a compile error here rather than an `undefined` at runtime. That is the payoff for
 * RPC carrying domain types instead of a frozen wire shape: the console and the server ship together, so
 * they can share the contract rather than translate across one.
 *
 * There is deliberately no hand-written client, no fetch wrapper and no query-key convention. `query` and
 * `mutation` derive from the group.
 */
import { RPC_V1_PATH, RpcV1 } from "@ea/api/v1"
import { createIsomorphicFn } from "@tanstack/react-start"
import { Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { AtomRpc } from "effect/reactivity"
import { RpcClient, RpcSerialization } from "effect/rpc"

/**
 * Where the API lives, and it is a build-time choice rather than a runtime one.
 *
 * Three deployment shapes, and the value of this variable is what distinguishes them:
 *
 *   unset                       same-origin. `vite dev` proxies `/api` to `wrangler dev`, and on Pages the
 *                               `functions/api/[[path]].ts` proxy forwards to the Worker over a service
 *                               binding. No CORS, no cookie domain, nothing to configure.
 *   `https://api.example.com`   the real-world shape: the API on its own subdomain. Then the Worker needs
 *                               `CONSOLE_ORIGIN` and `COOKIE_DOMAIN` set too — all three together, because a
 *                               deployment with two of the three logs in and then silently logs out.
 *
 * `import.meta.env` rather than a runtime fetch of configuration: the URL is needed before the first request,
 * and an app that has to ask where its API is cannot render until it knows.
 */
const API_ORIGIN = (import.meta.env["VITE_API_ORIGIN"] as string | undefined) ?? ""

/**
 * The base the RPC client's URLs are built on, which differs by side.
 *
 * Effect's HTTP client resolves a request URL BEFORE it reaches `fetch`, so on the server a relative
 * `/api/rpc/v1` fails as `InvalidUrlError` — there is no page origin to resolve it against. Found by dehydrating
 * the first server-run query, which carried exactly that failure into the HTML. The server therefore uses
 * `http://api.binding`, the base the binding transport below routes and never resolves; the browser keeps the
 * configured origin, relative by default.
 */
const API_BASE = createIsomorphicFn().client(() => API_ORIGIN).server(() => "http://api.binding")()

interface ApiBinding {
  readonly fetch: (request: Request) => Promise<Response>
}

/** Headers that describe the visitor's own request body or connection, never an RPC call made on their behalf. */
const NOT_FORWARDED = new Set(["content-type", "content-length", "transfer-encoding", "connection", "accept-encoding"])

/**
 * The transport, so the SAME atoms run in the browser and during SSR.
 *
 * Effect Atom's SSR model is: run serializable atoms in a registry on the server, `Hydration.dehydrate` it, and
 * `HydrationBoundary` it into the browser's registry (see `atoms/dehydrate.ts`). That needs these atoms to work on
 * the server, and a relative `/api/rpc/v1` fetch has no origin there. So, as in `auth/auth-client.ts`:
 *
 * - **browser** — plain `fetch`, same-origin, cookies attached by the browser.
 * - **server** — the `API` service binding, with the CURRENT visitor's headers read from Start's request context
 *   at call time. Per call, not per runtime: this runtime is shared across requests, and capturing headers once
 *   would answer one visitor's query with another's session. The host matters as much as the cookie — better-auth
 *   derives its base URL from it, and a server call without it threw `Invalid base URL: /`.
 *
 * `createIsomorphicFn` strips the server branch from the client bundle, and its imports are dynamic so neither
 * `cloudflare:workers` nor Start's server module enters the client's graph.
 */
const isomorphicFetch = createIsomorphicFn()
  .client((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init))
  .server(async (input: RequestInfo | URL, init?: RequestInit) => {
    const [{ env }, { getRequest }] = await Promise.all([
      import("cloudflare:workers"),
      import("@tanstack/react-start/server")
    ])
    const headers = new Headers(init?.headers)
    for (const [name, value] of getRequest().headers) {
      if (!NOT_FORWARDED.has(name.toLowerCase()) && !headers.has(name)) headers.set(name, value)
    }
    // `http://api.binding` is a base for URL construction, never a destination — see `auth/auth-client.ts`.
    const url = new URL(input instanceof Request ? input.url : String(input), "http://api.binding")
    return (env as unknown as { readonly API: ApiBinding }).API.fetch(new Request(url, { ...init, headers }))
  })

export class Api extends AtomRpc.Service<Api>()("console/Api", {
  group: RpcV1,
  /*
   * `credentials: "include"` is NOT set here, and that is deliberate rather than an omission.
   *
   * Same-origin sends cookies without it. Cross-origin needs it — and it needs the server's CORS to allow
   * credentials and name this exact origin, which `Main.ts` does only when `CONSOLE_ORIGIN` is set. Adding it
   * unconditionally would make the same-origin case send credentials it did not need to declare, and would
   * hide the fact that the cross-origin case has three coupled settings rather than one.
   *
   * When the subdomain shape is activated, this gains a `fetch` wrapper that sets it; the comment is here so
   * that whoever does it sees the other two settings named.
   */
  protocol: RpcClient.layerProtocolHttp({ url: `${API_BASE}${RPC_V1_PATH}` }).pipe(
    // JSON, matching the server. Readable in devtools, which for an internal tool is worth more than bytes.
    Layer.provide(Layer.mergeAll(
      FetchHttpClient.layer.pipe(
        Layer.provide(Layer.succeed(FetchHttpClient.Fetch)(isomorphicFetch as unknown as typeof globalThis.fetch))
      ),
      RpcSerialization.layerJson
    ))
  )
}) {}
