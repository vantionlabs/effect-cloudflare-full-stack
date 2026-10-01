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
import { apiKey } from "@better-auth/api-key"
import { betterAuth, type BetterAuthOptions } from "better-auth"
import { organization } from "better-auth/plugins"
import { Client, Pool } from "pg"
import { organizationRoles, productRoleGuard } from "./Roles.ts"

/**
 * One transactional message, as better-auth's side of the `Email` port.
 *
 * A plain callback and a plain shape rather than the `Email` service itself, because better-auth's hooks are
 * `async` functions and this file is also the input to `@better-auth/cli generate` — it should stay readable as
 * configuration. `SessionHttp.ts` is where the port is bridged onto it.
 */
export interface AuthEmail {
  readonly to: string
  readonly subject: string
  readonly text: string
}

export interface AuthConfig {
  readonly connectionString: string
  readonly baseURL: string
  /**
   * Every host this deployment is legitimately served under, as host patterns (`*` allowed).
   *
   * Empty means `baseURL` is the only one, which is right for a fixed hostname. It is NOT right for
   * Cloudflare Pages, where every preview deployment gets its own hostname — `<hash>.<project>.pages.dev`
   * and `<branch>.<project>.pages.dev` — so no single string can name the origin the browser used.
   *
   * This is the reason it exists: better-auth trusts `baseURL`'s origin and nothing else by default, so a
   * preview deployment was refused with `INVALID_ORIGIN` on sign-up. That refusal was CORRECT — the request
   * really did come from an origin the server had not been told about — and the fix is to tell it, not to
   * relax the check.
   *
   * **A pattern must be scoped to a hostname we control.** `*` here compiles to `[^/\\]`, which crosses
   * dots, so `*.pages.dev` would trust every Cloudflare Pages project on the internet — any of which could
   * then post credentialed requests at us. `*.effect-ai-console-dev.pages.dev` is safe because the project
   * label is ours; the wildcard's looseness is not what makes it safe.
   */
  readonly allowedHosts?: ReadonlyArray<string> | undefined
  readonly secret: string
  /** The console's origin when it differs from the API's. Undefined means same-origin. */
  readonly consoleOrigin?: string | undefined
  /** `.example.com`, when console and API are sibling subdomains. Undefined means a host-only cookie. */
  readonly cookieDomain?: string | undefined
  /**
   * Delivers one message, or **undefined for no email capability at all**.
   *
   * Undefined is not a degraded mode — it removes the three senders below, so better-auth never offers a flow
   * it cannot complete. That is why it is a callback rather than a flag: a sender that silently discarded the
   * message would leave `forgetPassword` answering 200 with nothing ever arriving, which is indistinguishable
   * from a provider outage and takes a support ticket to notice.
   *
   * It must not reject. `SessionHttp.ts` logs and swallows an `EmailNotSent`: better-auth swallows a rejected
   * sender on most paths but not on `/send-verification-email`, where it becomes a 500 — see that file.
   */
  readonly sendEmail?: ((message: AuthEmail) => Promise<void>) | undefined
}

/**
 * The part of a better-auth instance this repo uses, written out rather than inferred.
 *
 * **Why this exists: `TS2883`.** Passing any options to `organization()` — here, `sendInvitationEmail` — made
 * `makeAuth`'s inferred type reference zod's `$strip` and better-auth's internal `SchemaCheck`, which bun's
 * isolated install leaves unnameable from this package, so declaration emit failed. Bisected, not guessed:
 * the email and reset senders are innocent, and widening the options to `OrganizationOptions` did not help.
 *
 * Results are `unknown` on purpose. Every caller already narrows to a structural type at the call site
 * (`SessionStore.ts`), so the inferred plugin types were never load-bearing — and naming only what is used is
 * the same discipline as `BetterAuthService`, one level down.
 */
export interface AuthInstance {
  readonly handler: (request: Request) => Promise<Response>
  /** Read by `acquireAuth` to close the pool, and by `scripts/auth-schema.ts` to derive the tables. */
  readonly options: BetterAuthOptions
  readonly api: {
    readonly getSession: (input: { readonly headers: Headers }) => Promise<unknown>
    readonly getActiveMemberRole: (input: { readonly headers: Headers }) => Promise<unknown>
    readonly verifyApiKey: (input: { readonly body: { readonly key: string } }) => Promise<unknown>
  }
}

/**
 * Builds a better-auth instance.
 *
 * Constructed **per request**, for the same reason the `PgClient` is: a TCP socket cannot
 * outlive the request that opened it on Workers. Hyperdrive keeps the pool warm outside the
 * Worker, so `max: 1` here is not the bottleneck it would be on a long-lived server — and a
 * larger pool would only consume more of the six-connection budget.
 */
export const makeAuth = (config: AuthConfig): AuthInstance => {
  const pool = new Pool({ connectionString: config.connectionString, max: 1 })

  // Bound once so the three senders below read as configuration rather than as repeated lookups.
  const sendEmail = config.sendEmail

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
    /*
     * A string when one hostname serves this deployment; better-auth's dynamic form when several do.
     *
     * The dynamic form derives the base URL from the request's own host, having first checked it against
     * `allowedHosts` — and, importantly, it derives `trustedOrigins` from the same list, so the two cannot
     * disagree. `fallback` is what an unlisted host gets instead of a thrown error, which is the difference
     * between a misconfigured host answering on the canonical origin and the Worker failing the request.
     */
    baseURL: config.allowedHosts === undefined || config.allowedHosts.length === 0
      ? config.baseURL
      : {
        allowedHosts: [...config.allowedHosts],
        /*
         * `protocol` is deliberately OMITTED, and this is not an oversight.
         *
         * Setting it to `"https"` short-circuits better-auth's protocol derivation *unconditionally* — it
         * does not exempt loopback. Local dev on `http://localhost:8799` would then resolve a base URL of
         * `https://localhost:8799`, better-auth would mark the session cookie `Secure`, and the browser
         * would drop it on an http origin: sign-in appears to succeed and the next request is anonymous,
         * with nothing in any log. Omitted, the protocol comes from the request — http locally, https on
         * Pages — and the trusted list gets the `http://` variant only for loopback hosts.
         */
        fallback: config.baseURL
      },
    secret: config.secret,

    emailAndPassword: {
      enabled: true,
      /*
       * **Off by default in better-auth 1.7.6** (`api/routes/password.mjs` only deletes sessions when this is
       * set), which means a reset left every existing session alive. A reset is often the response to a
       * suspected compromise, and one that does not sign the intruder out does not answer it.
       */
      revokeSessionsOnPasswordReset: true,
      /*
       * **Without this, password reset does not exist** — better-auth 1.7.6 answers `400 RESET_PASSWORD_DISABLED`
       * (read in `dist/api/routes/password.mjs`, not assumed; an earlier draft of this comment claimed it
       * answered 200 and silently did nothing, which was wrong). So the user-visible gain from defining the
       * senders now is a working reset flow, with the console stub printing the link until Resend is configured.
       *
       * The sender is awaited, not backgrounded: `runInBackgroundOrAwait` only backgrounds when
       * `advanced.backgroundTasks` is configured, and on Workers a background promise without `waitUntil` can
       * be dropped when the response returns. A slow provider therefore adds latency to the request instead.
       *
       * The `url` is better-auth's own — it points at ITS endpoint, which validates the token and then
       * redirects to the console. Constructing one here would duplicate token handling it already does.
       */
      ...sendEmail === undefined ? {} : {
        sendResetPassword: async ({ url, user }: { readonly url: string; readonly user: { readonly email: string } }) =>
          sendEmail({
            to: user.email,
            subject: "Reset your password",
            text: `Open this link to choose a new password:\n\n${url}\n\n` +
              `If you did not ask for this, nothing has changed and you can ignore this message.`
          })
      }
    },

    /*
     * Verification is configured but **not required**, and the distinction is load-bearing.
     *
     * `requireEmailVerification` would make the console unusable the moment the console stub is the adapter —
     * sign-up would succeed and sign-in would refuse until a link nobody can click is clicked. So the endpoint
     * exists and can be driven deliberately, and `sendOnSignUp` stays off until there is a verified sending
     * domain and a console page to land on.
     */
    ...sendEmail === undefined ? {} : {
      emailVerification: {
        sendVerificationEmail: async (
          { url, user }: { readonly url: string; readonly user: { readonly email: string } }
        ) =>
          sendEmail({
            to: user.email,
            subject: "Confirm your email address",
            text: `Open this link to confirm your email address:\n\n${url}`
          })
      }
    },

    /*
     * Cross-origin, only when it actually is.
     *
     * Same-origin needs none of this and gets none of it: no cross-origin trusted list, no cookie domain, no
     * CORS — the three settings most likely to be subtly wrong, absent rather than defaulted. That is the
     * local `vite dev` shape and the Pages-proxy shape.
     *
     * An earlier version of this comment claimed the Pages-proxy shape needed nothing at all. **That was
     * wrong, and a deployed sign-up returned 403 `INVALID_ORIGIN` to prove it.** Same-origin does not mean
     * "no origin configuration"; it means the browser's origin and the server's `baseURL` are the same
     * origin, and they were not — `BASE_URL` was unset, so it defaulted to `http://localhost:8799` while the
     * browser was on `*.pages.dev`. `allowedHosts` above is what fixes that, and it is a different concern
     * from the three settings below: which hostnames serve this deployment, not which foreign origin to let
     * in.
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

    // Refuses roles the product does not know on invite and role change — see `Roles.ts`.
    hooks: { before: productRoleGuard },

    plugins: [
      // Organizations are the tenant boundary. better-auth owns `organization`, `member` and
      // `invitation`; our tables carry `organization_id` with no foreign key into them, so its
      // schema upgrades never become our migration problem.
      organization(
        /*
         * An invitation is the one message whose link this file has to build: the plugin hands over the
         * invitation id and leaves the URL to the application, because only the application knows where its
         * accept page lives. `consoleOrigin` when the console is a separate origin, `baseURL` when it is not.
         *
         * The console's page for it is `/accept-invitation/$invitationId`.
         *
         * `roles` names this product's roles — see `Roles.ts` for why an unnamed role locks the invitee out. No `ac`:
         * that option is for dynamic, database-stored roles, and these are static.
         */
        {
          roles: organizationRoles,
          ...(sendEmail === undefined ? {} : {
            sendInvitationEmail: async (
              data: {
                readonly id: string
                readonly email: string
                readonly inviter: { readonly user: { readonly name?: string | undefined; readonly email: string } }
                readonly organization: { readonly name: string }
              }
            ) => {
              const origin = config.consoleOrigin ?? config.baseURL
              const inviter = data.inviter.user.name ?? data.inviter.user.email
              await sendEmail({
                to: data.email,
                subject: `${inviter} invited you to ${data.organization.name}`,
                text: `${inviter} invited you to join ${data.organization.name}.\n\n` +
                  `Open this link to accept:\n\n${origin}/accept-invitation/${data.id}`
              })
            }
          })
        }
      ),
      /*
       * API keys, and the plugin owns all of it: generation, hashing, the display prefix, expiry, per-key rate
       * limiting, quotas and scopes. This replaced a hand-rolled `api_keys` table — which was a mistake, and the
       * kind this repo has a standing rule against: the plugin is version-matched (`1.7.6`, same as
       * `better-auth`) and does strictly more.
       *
       * **`references: "user"`, not `"organization"`, and the reason is `approved_by`.** Reading the plugin's
       * source: with organization-owned keys the creating user is NOT stored — `referenceId` is the organization
       * and nothing records a person. Our `Identity` needs a `userId`, because a decision approved by a program
       * still has to be attributable to whoever authorised the automation (ADR-0022). So a key references its
       * user, and the organization travels in `metadata`, checked against `member` on every request — which is
       * what makes caller-supplied metadata safe rather than trusted.
       *
       * `disableKeyHashing` is left at its default. Saying so because the option exists, and storing these in
       * plaintext would make one database breach every customer's credentials.
       */
      apiKey({
        references: "user",
        enableMetadata: true,
        /*
         * `ea_` so the string announces itself in a log, a commit or a screenshot — recognisable beats obscure,
         * and secret scanners key on prefixes.
         */
        defaultPrefix: "ea_",
        /*
         * The plugin's own per-key rate limit, which is accounting a key can be held to rather than the
         * per-colo approximation Cloudflare's binding provides (PLAN.md's R-series notes why that binding is
         * explicitly not an accounting system). 1,000 per hour matches the contractual figure the plan uses as
         * its example.
         */
        rateLimit: { enabled: true, timeWindow: 60 * 60 * 1000, maxRequests: 1000 }
      })
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

    advanced: {
      /*
       * `Secure` decided by the CANONICAL origin, not by the scheme of the request that arrived.
       *
       * better-auth otherwise derives it from the per-request protocol, and behind the Pages Function proxy
       * that protocol is `http`: a service-binding dispatch is internal to Cloudflare's network, so it
       * carries no TLS and `request.url` says `http://` even though the browser is on https. The result was
       * a session cookie served over https with **no `Secure` flag** — verified on the deployed site, which
       * answered `HttpOnly; SameSite=Lax` and nothing else.
       *
       * `baseURL` is the right input because it is what the deployment says it is reachable as: `https://`
       * for anything deployed, `http://localhost:8799` locally. Deriving from it keeps local development
       * working — a `Secure` cookie on an http origin is dropped by the browser, which is the same silent
       * "signed in, then anonymous" failure from the other direction — without trusting a forwarded header,
       * which would be a header an attacker can also send.
       */
      useSecureCookies: config.baseURL.startsWith("https://"),
      ...config.cookieDomain === undefined ? {} : {
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
