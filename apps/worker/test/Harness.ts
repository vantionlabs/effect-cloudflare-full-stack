/**
 * A real Worker, a real database, over real HTTP — shared by every integration test.
 *
 * Extracted rather than copied because one detail here is easy to get subtly wrong and silently
 * turns every test in a file into a 403: better-auth compares `Origin` against its configured
 * `baseURL`, **not** against the request URL, and the harness binds a random port. So requests
 * carry the baseURL as `Origin` and use relative paths.
 */
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

  return {
    fetch,
    post,
    signedInWithOrg,
    origin: ORIGIN,
    /*
     * `close`, not `dispose`. This called `server?.dispose?.()` — a method `TestHarness` does not
     * have — so the optional call silently did nothing and NO test server was ever shut down. It
     * only surfaced when apps/worker/test was typechecked for the first time.
     */
    dispose: () => server.close()
  }
}
