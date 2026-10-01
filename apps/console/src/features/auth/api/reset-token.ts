/**
 * Whether a password-reset token is still spendable, asked ON THE SERVER before the reset page renders.
 *
 * Without this the page trusted `?token=` until submit: anyone could open `/reset-password?token=anything`, get a
 * working-looking form, type a new password, and only then be told the link was dead. better-auth has no "check"
 * endpoint, but its emailed-link callback (`GET /reset-password/:token`) is one in effect — it looks the token up,
 * does NOT consume it (read in `api/routes/password.mjs`, 1.7.6), and redirects with either `?token=` or
 * `?error=INVALID_TOKEN`. So this calls it and reads the redirect.
 *
 * **`callbackURL` must be ABSOLUTE.** The first version passed `/reset-password` and better-auth threw
 * `Invalid base URL: /` — so the response was not a redirect, the check failed closed, and EVERY token read as
 * invalid, the good ones included. A test with a made-up token passed for exactly that wrong reason; the server
 * log is what gave it away. The origin is the incoming request's own, which is the console's, and is trusted.
 * (Making it absolute was not enough on its own — see the headers below.)
 *
 * Over the service binding directly rather than through `authClient`, because what is needed is the `Location`
 * header of a redirect the client would follow. A GET, so no `Origin` is needed (see `auth-client.ts`).
 */
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { Schema } from "effect"

interface ApiBinding {
  readonly fetch: (request: Request) => Promise<Response>
}

const Input = Schema.Struct({ token: Schema.String })

export const checkResetToken = createServerFn({ method: "GET" })
  .inputValidator(Schema.toStandardSchemaV1(Input))
  .handler(async ({ data }): Promise<{ readonly valid: boolean }> => {
    const { env } = await import("cloudflare:workers")
    // `http://api.binding` is a base for URL construction, never a destination — see `auth-client.ts`.
    const url = new URL(`/api/auth/reset-password/${encodeURIComponent(data.token)}`, "http://api.binding")
    url.searchParams.set("callbackURL", new URL("/reset-password", getRequest().url).href)
    const response = await (env as unknown as { readonly API: ApiBinding }).API.fetch(
      /*
       * The visitor's headers, as `current-session.ts` forwards them. Not for the cookie — this endpoint needs no
       * session — but for the HOST: better-auth derives its base URL per request from the allowed hosts, and with
       * no headers it resolved to "/" and threw. That was the second half of the every-token-is-invalid bug.
       */
      new Request(url, { redirect: "manual", headers: getRequest().headers })
    )
    const location = response.headers.get("location") ?? ""
    // Fail closed: anything other than a redirect carrying the token back is treated as unusable.
    return { valid: location.includes("token=") && !location.includes("error=") }
  })
