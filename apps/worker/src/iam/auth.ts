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

    // Same-origin means no trustedOrigins list, no cookie domain, and no CORS layer — the
    // three settings most likely to be subtly wrong. CSRF protection stays on.
    emailAndPassword: { enabled: true },

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
