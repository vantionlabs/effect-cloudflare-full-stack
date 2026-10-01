/**
 * The organization's usage report, fetched ON THE SERVER for the usage page's loader.
 *
 * Same shape as `auth/current-session.ts`: a GET server function that forwards the visitor's headers, so the
 * session cookie decides which organization is reported and the HTML arrives with the numbers in it rather than
 * a spinner that fills in after hydration. It reads the public `GET /api/v1/usage` over the service binding — the
 * console uses the same contract a third-party integrator does, and decodes it with the same schema.
 *
 * A GET, so no `Origin` is needed for better-auth's CSRF check (see `auth/auth-client.ts`).
 */
import { UsageReportV1 } from "@ea/modules/shared/domain/Usage"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { Schema } from "effect"

interface ApiBinding {
  readonly fetch: (request: Request) => Promise<Response>
}

/** A projection that crosses into the SSR payload: plain data, no class instances. */
export type UsageView =
  | { readonly _tag: "Report"; readonly report: typeof UsageReportV1.Encoded }
  | { readonly _tag: "Unavailable"; readonly status: number }

export const getUsageReport = createServerFn({ method: "GET" }).handler(async (): Promise<UsageView> => {
  const { env } = await import("cloudflare:workers")
  // `http://api.binding` is a base for URL construction, never a destination — see `auth/auth-client.ts`.
  const response = await (env as unknown as { readonly API: ApiBinding }).API.fetch(
    new Request(new URL("/api/v1/usage", "http://api.binding"), { headers: getRequest().headers })
  )
  if (!response.ok) return { _tag: "Unavailable", status: response.status }
  // Decoded with the contract's own schema, then re-encoded to plain JSON for the SSR payload.
  const report = Schema.decodeUnknownSync(UsageReportV1)(await response.json())
  return { _tag: "Report", report: Schema.encodeSync(UsageReportV1)(report) }
})
