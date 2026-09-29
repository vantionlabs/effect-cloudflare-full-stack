/**
 * Forwards `/api/*` to the Worker, so the console on Pages stays same-origin.
 *
 * `[[path]]` is Pages' catch-all: it matches `/api`, `/api/v1/intakes`, `/api/rpc/v1` and everything below.
 * Only those paths invoke a Function — `public/_routes.json` narrows it — so every other request is served
 * as a static asset and costs no invocation, which is the same property the Worker's `assets` binding gave.
 *
 * **The request is forwarded UNCHANGED, and that is the whole trick.** A service binding's `fetch` takes a
 * real `Request`, so the Worker sees the original URL: `https://<console-host>/api/...`. Two things depend
 * on that, and both would break in ways nobody notices until a user complains:
 *
 *   - **Cookies.** better-auth sets the session cookie for the host in the request. Rewriting the URL to the
 *     Worker's own hostname would set it for a host the browser never visits, so the user would appear to log
 *     in successfully and then be anonymous on the next request.
 *   - **better-auth's `baseURL` and its CSRF origin check** both read the request URL.
 *
 * So there is no rewriting, no header surgery and no `X-Forwarded-*`. The Worker cannot tell it was proxied,
 * which is exactly what makes this equivalent to having been served from one origin.
 *
 * **Unverified by execution**, like the AI Gateway URL: a Pages deployment and a service binding to a
 * deployed Worker are both required to exercise it, and neither exists yet. The failure modes are listed
 * above rather than discovered.
 */

interface Env {
  /**
   * The API Worker, bound service-to-service.
   *
   * In-network Worker-to-Worker: no public request, no egress charge, no token. The binding name is what
   * `wrangler.jsonc` declares; the `service` it points at is the Worker's `name`, so renaming the Worker
   * breaks this at deploy time rather than at runtime.
   */
  readonly API: { readonly fetch: (request: Request) => Promise<Response> }
}

export const onRequest = (context: {
  readonly request: Request
  readonly env: Env
}): Promise<Response> =>
  /*
   * `context.request` verbatim, not a reconstructed one.
   *
   * Rebuilding it would drop the body on anything but GET — and an upload is a POST of raw bytes. The failure
   * would not be an error: it would be an empty document that parses to an empty string and extracts nothing,
   * and a confident decision about nothing is the worst outcome available in this product.
   */
  context.env.API.fetch(context.request)
