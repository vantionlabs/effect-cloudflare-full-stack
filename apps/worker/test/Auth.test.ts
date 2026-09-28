/**
 * The auth seam, end to end, in real workerd against real Postgres.
 *
 * The valuable assertions here are the *refusals*. A test that only proves a signed-in user can
 * read their own identity would pass on an implementation that authenticates nobody correctly.
 */
import { MeV1 } from "@ea/shared-domain/api"
import { Schema } from "effect"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createTestHarness } from "wrangler"

let server: ReturnType<typeof createTestHarness>
let origin: string

/**
 * better-auth's CSRF protection compares `Origin` against its configured `baseURL`, NOT against
 * the request URL. The harness binds a random port, so tests send the baseURL as Origin and use
 * relative paths — which decouples them from whatever port the harness picked.
 */
const post = (path: string, body: unknown, cookie?: string) =>
  server.fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      ...(cookie === undefined ? {} : { cookie })
    },
    body: JSON.stringify(body)
  })

const cookiesFrom = (response: Response): string =>
  response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ")

beforeAll(async () => {
  server = createTestHarness({
    workers: [{ configPath: new URL("../wrangler.jsonc", import.meta.url).pathname }]
  })
  await server.listen()
  // Must match better-auth's baseURL (see `post` above), not the harness's bound port.
  origin = "http://localhost:8799"
})

afterAll(async () => {
  await server?.dispose?.()
})

/** Signs up, creates an organization, activates it. Returns the session cookie. */
const signedInWithOrg = async () => {
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

describe("refusals", () => {
  it("401s an unauthenticated request to a protected endpoint", async () => {
    const response = await server.fetch("/api/v1/me")
    expect(response.status).toBe(401)
  })

  it("401s a valid session with NO active organization", async () => {
    // The important one. Silently defaulting to "their first organization" is a cross-tenant
    // leak: a user in two orgs would act in whichever the query happened to return first. If the
    // session has not chosen, there is nothing to act in.
    const signUp = await post("/api/auth/sign-up/email", {
      email: `noorg-${Date.now()}@example.com`,
      password: "correct-horse-battery-staple",
      name: "No Org"
    })
    expect(signUp.status).toBe(200)

    const response = await server.fetch("/api/v1/me", {
      headers: { cookie: cookiesFrom(signUp) }
    })
    expect(response.status).toBe(401)
  })

  it("rejects a state-changing auth request with no Origin (CSRF)", async () => {
    // Same-origin deployment means the session cookie IS sent on cross-site form posts, so CSRF
    // protection is load-bearing rather than redundant.
    const response = await server.fetch("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "x@example.com", password: "aaaaaaaaaaaa", name: "X" })
    })
    expect(response.status).toBeGreaterThanOrEqual(400)
  })

  it("leaves the public health endpoint unauthenticated", async () => {
    // Guards against over-applying the middleware: a monitor must not need credentials.
    const response = await server.fetch("/api/v1/health")
    expect(response.status).toBe(200)
  })
})

describe("GET /api/v1/me", () => {
  it("returns the identity, organization and role from the member table", async () => {
    const { cookie, organizationId } = await signedInWithOrg()

    const response = await server.fetch("/api/v1/me", { headers: { cookie } })
    expect(response.status).toBe(200)

    const me = Schema.decodeUnknownSync(MeV1)(await response.json())
    expect(me.organization_id).toBe(organizationId)
    // Read from `member`, not asserted by the session — the creator is the owner.
    expect(me.role).toBe("owner")
    expect(me.email).toContain("@example.com")
  })

  it("survives repeated requests to the same isolate", async () => {
    // Regression guard, and the second time this class of bug appeared. better-auth holds a `pg`
    // Pool; a TCP socket cannot outlive the request that opened it on Workers. Memoising the
    // instance per isolate gave: request 1 ok, request 2 broken, request 3 HANGS the Worker.
    // Only the settings are read at layer-build time now; the pool is per request.
    const { cookie } = await signedInWithOrg()

    for (let i = 0; i < 3; i++) {
      const response = await server.fetch("/api/v1/me", { headers: { cookie } })
      expect(response.status, `request ${i + 1} of 3`).toBe(200)
    }
  })
})
