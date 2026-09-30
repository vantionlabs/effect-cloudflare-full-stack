/**
 * A real Worker, a real database, over real HTTP — shared by every integration test.
 *
 * Extracted rather than copied because one detail here is easy to get subtly wrong and silently
 * turns every test in a file into a 403: better-auth compares `Origin` against its configured
 * `baseURL`, **not** against the request URL, and the harness binds a random port. So requests
 * carry the baseURL as `Origin` and use relative paths.
 */
import { Client } from "pg"
import { expect } from "vitest"
import { createTestHarness } from "wrangler"

/** Must match better-auth's `baseURL` default in BetterAuth.ts, not the harness's bound port. */
const ORIGIN = "http://localhost:8799"

/*
 * Request and Response types taken FROM wrangler rather than restated.
 *
 * `createTestHarness` returns the Workers-flavoured `Response` (it is wrangler's own dispatcher), and
 * writing `Promise<Response>` here meant lib.dom's — which typechecked nowhere and produced
 * `Response_2 is not assignable to Response` the first time apps/worker/test was checked at all.
 * Deriving them keeps the two in step through a wrangler upgrade, where restating them would drift.
 */
type HarnessFetch = ReturnType<typeof createTestHarness>["fetch"]
type HarnessRequestInit = Parameters<HarnessFetch>[1]
export type HarnessResponse = Awaited<ReturnType<HarnessFetch>>

export interface Harness {
  readonly fetch: (path: string, init?: HarnessRequestInit) => Promise<HarnessResponse>
  /** A JSON POST carrying `Origin`, which better-auth's CSRF check requires. */
  readonly post: (path: string, body: unknown, cookie?: string) => Promise<HarnessResponse>
  /** Signs up a fresh user, creates an organization and activates it. */
  readonly signedInWithOrg: () => Promise<{ cookie: string; organizationId: string }>
  /**
   * Signs up a fresh user and makes them a member of an EXISTING organization.
   *
   * The membership row is written directly rather than through better-auth's invitation flow, which is an invite
   * plus an accept plus an email. What the tests using this need is a second person in one organization — the
   * only shape in which 403-not-404 is observable — and the invitation mechanics are better-auth's to test.
   *
   * The role is `reviewer`, one of OURS. better-auth's own default is `member`, which is not in our closed set —
   * writing that here produced a 500 and found a real bug in `resolveIdentity`, which used to CAST the role
   * rather than decode it.
   */
  readonly signedInAs: (organizationId: string) => Promise<{ cookie: string; userId: string }>
  readonly origin: string
  readonly dispose: () => Promise<void>
}

export const cookiesFrom = (response: HarnessResponse): string =>
  response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ")

export const startHarness = async (): Promise<Harness> => {
  const server = createTestHarness({
    workers: [{ configPath: new URL("../wrangler.jsonc", import.meta.url).pathname }]
  })
  await server.listen()

  const fetch = (path: string, init?: HarnessRequestInit) => server.fetch(path, init)

  const post = (path: string, body: unknown, cookie?: string) =>
    fetch(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        ...(cookie === undefined ? {} : { cookie })
      },
      body: JSON.stringify(body)
    })

  const signedInWithOrg = async () => {
    // Unique per call so tests never collide on the email unique index, and so a re-run against
    // an already-migrated database does not depend on cleanup.
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const signUp = await post("/api/auth/sign-up/email", {
      email: `test-${unique}@example.com`,
      password: "correct-horse-battery-staple",
      name: "Test User"
    })
    expect(signUp.status).toBe(200)
    let cookie = cookiesFrom(signUp)

    const created = await post("/api/auth/organization/create", {
      name: "Acme BV",
      slug: `acme-${unique}`
    }, cookie)
    expect(created.status).toBe(200)
    const organizationId = (await created.json() as { id: string }).id

    const activated = await post("/api/auth/organization/set-active", { organizationId }, cookie)
    expect(activated.status).toBe(200)
    cookie = cookiesFrom(activated) || cookie

    return { cookie, organizationId }
  }

  const signedInAs = async (organizationId: string) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const email = `member-${unique}@example.com`
    const signUp = await post("/api/auth/sign-up/email", {
      email,
      password: "correct-horse-battery-staple",
      name: "Second User"
    })
    expect(signUp.status).toBe(200)
    let cookie = cookiesFrom(signUp)

    const client = new Client({
      host: process.env["PGHOST"] ?? "localhost",
      port: Number(process.env["PGPORT"] ?? 55433),
      user: process.env["PGUSER"] ?? "effect_ai",
      password: process.env["PGPASSWORD"] ?? "local_dev_only",
      database: process.env["PGDATABASE"] ?? "effect_ai"
    })
    await client.connect()
    let userId: string
    try {
      const found = await client.query<{ id: string }>(`select id from "user" where email = $1`, [email])
      userId = found.rows[0]!.id
      await client.query(
        `insert into member (id, "organizationId", "userId", role, "createdAt") values ($1, $2, $3, 'reviewer', now())`,
        [`member_${unique}`, organizationId, userId]
      )
    } finally {
      await client.end()
    }

    const activated = await post("/api/auth/organization/set-active", { organizationId }, cookie)
    expect(activated.status).toBe(200)
    cookie = cookiesFrom(activated) || cookie

    return { cookie, userId }
  }

  return {
    fetch,
    post,
    signedInWithOrg,
    signedInAs,
    origin: ORIGIN,
    /*
     * `close`, not `dispose`. This called `server?.dispose?.()` — a method `TestHarness` does not
     * have — so the optional call silently did nothing and NO test server was ever shut down. It
     * only surfaced when apps/worker/test was typechecked for the first time.
     */
    dispose: () => server.close()
  }
}
