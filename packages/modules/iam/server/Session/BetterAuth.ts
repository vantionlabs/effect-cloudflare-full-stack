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
import { Client, Pool } from "pg"

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
export const makeAuth = (config: AuthConfig) => {
  const pool = new Pool({ connectionString: config.connectionString, max: 1 })

  /**
   * Gives a user a personal organisation and returns its id. Idempotent, and **order-independent**.
   *
   * **Without this you can sign up and then nothing works.** `resolveIdentity` refuses a session with no
   * `activeOrganizationId` — deliberately, because there is no default organisation and a request that cannot
   * name its tenant must not be served. So a fresh user had a session, no membership, and every authenticated
   * request answered 401: no error, no log, just a product that could not be entered. Found by running it end
   * to end for the first time. No unit test could see it, because every test creates its own organisation.
   *
   * **Why one function called from BOTH hooks rather than two halves.** The first version split the work —
   * `user.create.after` created the organisation, `session.create.before` set the active id — and the
   * organisation and member rows appeared while `activeOrganizationId` stayed null. better-auth creates the
   * session before running the user after-hook, so the session hook looked for a membership that did not exist
   * yet. Rather than encode an assumption about hook order, this does the whole job whenever it is asked and
   * returns the same answer either way.
   *
   * **A DEDICATED CLIENT, not `pool.connect()`, and borrowing deadlocked before it was.** The pool is `max: 1`
   * because Workers allows six simultaneous outgoing connections and better-auth is one consumer of that
   * budget. But better-auth runs these hooks *while holding that single connection inside a transaction* — so
   * borrowing waits for a connection that is not released until the hook returns. The sign-up hung for two
   * minutes with Postgres reporting one connection `idle in transaction`, which is exactly what that looks
   * like. A short-lived client costs one extra connection during sign-up only, instead of permanently raising
   * the pool and spending the budget on every request to fix something that happens once per user.
   *
   * **SQL rather than `auth.api.createOrganization`** because calling the server API from inside a
   * `databaseHooks` callback means referring to the instance being constructed, and that self-reference cannot
   * be typed without widening `betterAuth`'s inferred type until the plugin surface is lost. These are
   * better-auth's tables used exactly as its own plugin uses them, and `bun run auth:check` fails CI if the
   * committed schema drifts from the installed library — so a column rename is caught rather than found here.
   */
  const ensureMembership = async (userId: string): Promise<string | null> => {
    const client = new Client({ connectionString: config.connectionString })
    await client.connect()
    try {
      const existing = await client.query<{ organizationId: string }>(
        `select "organizationId" from member where "userId" = $1 order by "createdAt" asc limit 1`,
        [userId]
      )
      const found = existing.rows[0]?.organizationId
      if (found !== undefined) return found

      const user = await client.query<{ email: string; name: string }>(
        `select email, name from "user" where id = $1`,
        [userId]
      )
      const row = user.rows[0]
      // Null rather than an invented organisation: a session for a user who does not exist is refused, which
      // is the honest answer and the one `resolveIdentity` already gives.
      if (row === undefined) return null

      const organizationId = `org_${userId}`
      /*
       * `on conflict do nothing` on both, because two requests can race here — a sign-up and the first
       * session, or two tabs. A duplicate organisation is worse than a retry, and the slug is unique per user
       * so the second insert is a no-op rather than an error.
       *
       * The slug is derived from the id, not the email: an email-derived slug puts the address in a URL, and
       * two users at one domain would collide.
       */
      await client.query(
        `insert into organization (id, name, slug, "createdAt")
         values ($1, $2, $3, now()) on conflict (id) do nothing`,
        [organizationId, row.name === "" ? row.email : row.name, `personal-${userId.toLowerCase()}`]
      )
      await client.query(
        `insert into member (id, "organizationId", "userId", role, "createdAt")
         values ($1, $2, $3, 'owner', now()) on conflict (id) do nothing`,
        [`mem_${userId}`, organizationId, userId]
      )
      return organizationId
    } finally {
      await client.end()
    }
  }

  return betterAuth({
    database: pool,
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

    databaseHooks: {
      // Both call the same function. Whichever fires first does the work; the other finds it done.
      user: { create: { after: async (user) => void await ensureMembership(user.id) } },
      session: {
        create: {
          /*
           * `after`, with `internalAdapter.updateSession` — which is what the organization plugin itself does.
           *
           * The first version used `create.before` and returned `{ data: { ...session, activeOrganizationId } }`.
           * The membership appeared and the field stayed null, silently: `activeOrganizationId` is not part of
           * the session INSERT payload better-auth accepts. Reading the plugin settled it — its own
           * `setActiveOrganization` calls
           * `context.internalAdapter.updateSession(token, { activeOrganizationId })`, an update after creation.
           * So this uses the same mechanism rather than a guess about the insert.
           */
          after: async (session, context) => {
            const organizationId = await ensureMembership(session.userId)
            if (organizationId === null || context === null) return
            await context.context.internalAdapter.updateSession(session.token, {
              activeOrganizationId: organizationId
            })
          }
        }
      }
    },

    plugins: [
      // Organizations are the tenant boundary. better-auth owns `organization`, `member` and
      // `invitation`; our tables carry `organization_id` with no foreign key into them, so its
      // schema upgrades never become our migration problem.
      organization()
    ],

    session: {
      /*
       * The cookie cache is OFF, and it was on until it was measured.
       *
       * It looked free: a signed cookie holding the session avoids a read on most requests. What it actually
       * did was serve a session that predated its own `activeOrganizationId`.
       *
       * The evidence, because this is worth not rediscovering. After sign-in, the `session` row in Postgres
       * read `activeOrganizationId = org_Pu8P…`, while better-auth's own `/api/auth/get-session` returned
       * `"activeOrganizationId": null` for the same request. The cache is written when the session is created;
       * the active organisation is set immediately afterwards by `databaseHooks.session.create.after`, because
       * the field is not part of the session INSERT — the organization plugin's own `setActiveOrganization`
       * calls `internalAdapter.updateSession` for the same reason. So the cached copy is stale from the moment
       * it is written, and `resolveIdentity` refuses a session with no active organisation.
       *
       * The symptom was a user who could sign up or sign in successfully and then get 401 on every
       * authenticated request for the next sixty seconds, with nothing in any log.
       *
       * Turning it off is also the consistent choice rather than merely the working one: this codebase
       * deliberately re-reads membership on every request so that revocation is near-immediate. A cache whose
       * whole purpose is to skip that read was arguing with that decision.
       *
       * If it comes back, it has to be written AFTER the active organisation is set, and the test is the one
       * above: compare the `session` row against `/api/auth/get-session` on a freshly created session.
       */
      cookieCache: { enabled: false }
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
}
