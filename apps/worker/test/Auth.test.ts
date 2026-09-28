/**
 * The auth seam, end to end, in real workerd against real Postgres.
 *
 * The valuable assertions here are the *refusals*. A test that only proves a signed-in user can
 * read their own identity would pass on an implementation that authenticates nobody correctly.
 */
import { MeV1 } from "@ea/shared-domain/api"
import { Schema } from "effect"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { cookiesFrom, type Harness, startHarness } from "./harness.ts"

let harness: Harness

beforeAll(async () => {
  harness = await startHarness()
})

afterAll(async () => {
  await harness?.dispose()
})

describe("refusals", () => {
  it("401s an unauthenticated request to a protected endpoint", async () => {
    const response = await harness.fetch("/api/v1/me")
    expect(response.status).toBe(401)
  })

  it("401s a valid session with NO active organization", async () => {
    // The important one. Silently defaulting to "their first organization" is a cross-tenant
    // leak: a user in two orgs would act in whichever the query happened to return first. If the
    // session has not chosen, there is nothing to act in.
    const signUp = await harness.post("/api/auth/sign-up/email", {
      email: `noorg-${Date.now()}@example.com`,
      password: "correct-horse-battery-staple",
      name: "No Org"
    })
    expect(signUp.status).toBe(200)

    const response = await harness.fetch("/api/v1/me", {
      headers: { cookie: cookiesFrom(signUp) }
    })
    expect(response.status).toBe(401)
  })

  it("rejects a state-changing auth request with no Origin (CSRF)", async () => {
    // Same-origin deployment means the session cookie IS sent on cross-site form posts, so CSRF
    // protection is load-bearing rather than redundant.
    const response = await harness.fetch("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "x@example.com", password: "aaaaaaaaaaaa", name: "X" })
    })
    expect(response.status).toBeGreaterThanOrEqual(400)
  })

  it("leaves the public health endpoint unauthenticated", async () => {
    // Guards against over-applying the middleware: a monitor must not need credentials.
    const response = await harness.fetch("/api/v1/health")
    expect(response.status).toBe(200)
  })
})

describe("GET /api/v1/me", () => {
  it("returns the identity, organization and role from the member table", async () => {
    const { cookie, organizationId } = await harness.signedInWithOrg()

    const response = await harness.fetch("/api/v1/me", { headers: { cookie } })
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
    const { cookie } = await harness.signedInWithOrg()

    for (let i = 0; i < 3; i++) {
      const response = await harness.fetch("/api/v1/me", { headers: { cookie } })
      expect(response.status, `request ${i + 1} of 3`).toBe(200)
    }
  })
})
