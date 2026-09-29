/**
 * The better-auth configuration.
 *
 * This file is also the input to `@better-auth/cli generate`, which produces the schema pasted
 * into `packages/shared/database/src/migrations/0003_auth.ts`. The CLI reads the plugin list
 * here to decide which tables to emit, so **changing the plugins means regenerating** — and
 * `bun run auth:check` fails CI if the committed migration drifts from what this config implies.
 *
 * `effect/sql` remains authoritative for every table including better-auth's: one migration
 * system, one database. `better-auth migrate` is never run (plan risk R9).
 *
 * **On the driver.** better-auth uses `pg` via Kysely, while the application uses
 * `@effect/sql-pg`. Two drivers is a deliberate trade: `pg` is the driver Cloudflare documents
 * for Hyperdrive (verified working in workerd), and hand-rolling a `DBAdapter` for a library
 * that ships several would be speculative work with subtle failure modes around field mapping
 * and id generation. The cost is two connections per request against Workers' limit of six
 * simultaneous outgoing connections — worth tracking if a request ever needs more.
 */
import { betterAuth } from "better-auth"
import { organization } from "better-auth/plugins"
import { Pool } from "pg"

export interface AuthConfig {
  readonly connectionString: string
  readonly baseURL: string
  readonly secret: string
  /** The console's origin when it differs from the API's. Undefined means same-origin. */
  readonly consoleOrigin?: string | undefined
  /** `.example.com`, when console and API are sibling subdomains. Undefined means a host-only cookie. */
  readonly cookieDomain?: string | undefined
}

/**
 * Builds a better-auth instance.
 *
 * Constructed **per request**, for the same reason the `PgClient` is: a TCP socket cannot
 * outlive the request that opened it on Workers. Hyperdrive keeps the pool warm outside the
 * Worker, so `max: 1` here is not the bottleneck it would be on a long-lived server — and a
 * larger pool would only consume more of the six-connection budget.
 */
export const makeAuth = (config: AuthConfig) =>
  betterAuth({
    database: new Pool({ connectionString: config.connectionString, max: 1 }),
    baseURL: config.baseURL,
    secret: config.secret,

    emailAndPassword: { enabled: true },

    /*
     * Cross-origin, only when it actually is.
     *
     * Same-origin needs none of this and gets none of it: no trusted-origins list, no cookie domain, no CORS
     * — the three settings most likely to be subtly wrong, absent rather than defaulted. That is the local
     * `vite dev` shape and the Pages-proxy shape.
     *
     * The real-world shape is an API on its own subdomain (`api.example.com` serving `app.example.com`), and
     * then all three are required together. They are set from one config each so that a deployment cannot
     * have two of the three — which is the state that produces "login works and then I am logged out",
     * because the cookie is set for the wrong host and nothing errors.
     *
     * CSRF protection stays on in every shape. `trustedOrigins` is what makes it correct rather than
     * disabled: the check is "did this credentialed request come from an origin we recognise", and the answer
     * for an API on its own subdomain is "yes, from the console" — not "stop asking".
     */
    ...config.consoleOrigin === undefined ? {} : { trustedOrigins: [config.consoleOrigin] },

    plugins: [
      // Organizations are the tenant boundary. better-auth owns `organization`, `member` and
      // `invitation`; our tables carry `organization_id` with no foreign key into them, so its
      // schema upgrades never become our migration problem.
      organization()
    ],

    session: {
      // A signed cookie cache avoids a session read on most requests without introducing a
      // second store. `maxAge` is the window in which a revoked session still works, so it stays
      // short: revocation should be near-immediate, and membership is re-checked every request
      // regardless (see AuthenticatedLive).
      cookieCache: { enabled: true, maxAge: 60 }
    },

    ...config.cookieDomain === undefined ? {} : {
      advanced: {
        /*
         * `Domain=.example.com`, so a sibling subdomain can send the session cookie.
         *
         * Note what is NOT set: `sameSite: "none"`. Sibling subdomains are the same *site*, so `Lax` still
         * applies and the cookie survives without opting into third-party-cookie territory — which browsers
         * are actively restricting and which would make the product depend on a setting being reversed.
         */
        crossSubDomainCookies: { enabled: true, domain: config.cookieDomain }
      }
    }
    // NOT using `secondaryStorage` (better-auth's Redis-style session store), deliberately.
    // Its interface requires ATOMIC operations:
    //
    //   getAndDelete(key)      -- atomically get and delete
    //   increment(key, ttl)    -- atomic counter, documented as "required so
    //                             secondary-storage-backed rate limiting can enforce the limit
    //                             in one distributed-safe operation"
    //
    // Cloudflare KV can do neither: it is eventually consistent with no atomic primitives, so
    // two concurrent requests both read N and write N+1. Backing secondaryStorage with KV would
    // therefore SILENTLY break rate limiting -- and a 6-digit OTP is only as strong as its
    // attempt counter.
    //
    // A Durable Object can (single-threaded, so atomic by construction), which is the documented
    // path when session reads become a measured bottleneck. Until then Postgres holds sessions:
    // correct, atomic, and one fewer store.
  })
