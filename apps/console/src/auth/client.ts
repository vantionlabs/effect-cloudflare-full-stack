/**
 * better-auth's own client, rather than three hand-written server functions.
 *
 * An earlier version of this file relayed `sign-in`, `sign-up` and `sign-out` through `createServerFn`,
 * copying `Set-Cookie` across by hand. That was a worse reimplementation of a library already in the
 * dependency tree: it returned one generic failure message, dropped better-auth's error codes, and would
 * have needed extending for every flow the product grows into — email verification, password reset,
 * organization invitations, social providers. All of those already exist here.
 *
 * It works because the console is ONE ORIGIN: `src/server.ts` forwards `/api/*` to the API over the
 * service binding, so a browser POST to `/api/auth/sign-in/email` is first-party. The cookie therefore
 * lands on the host the browser is on, with no CORS, no trusted-origins list and no cookie `Domain` —
 * ADR-0001's three coupled settings stay absent.
 *
 * `basePath` matches where the API mounts better-auth. No `baseURL`: leaving it unset keeps requests
 * relative, which is what makes them same-origin by construction rather than by configuration.
 */
import { createAuthClient } from "better-auth/react"

export const authClient = createAuthClient({
  basePath: "/api/auth"
})
