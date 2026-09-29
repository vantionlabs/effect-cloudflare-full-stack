/**
 * The auth seam, end to end, in real workerd against real Postgres.
 *
 * The valuable assertions here are the *refusals*. A test that only proves a signed-in user can
 * read their own identity would pass on an implementation that authenticates nobody correctly.
 */
import { MeV1 } from "@ea/modules/iam/domain/Identity"
import { Schema } from "effect"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { cookiesFrom, type Harness, startHarness } from "./Harness.ts"

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

  it("gives a new user a personal organization, so sign-up is usable", async () => {
    /*
     * This asserted 401 until the pipeline was run end to end for the first time — and the 401 was real:
     * sign-up created no organization, `resolveIdentity` refused a session that could not name a tenant, and
     * **a user could register and then get 401 on everything**, with nothing in any log. The test was
     * faithfully encoding a bug, which is the failure mode of a test written from the implementation.
     *
     * `databaseHooks` in `BetterAuth.ts` now creates a personal organization and sets it active. The refusal
     * this test used to carry is asserted below, on a state that has to be constructed deliberately.
     */
    const signUp = await harness.post("/api/auth/sign-up/email", {
      email: `fresh-${Date.now()}@example.com`,
      password: "correct-horse-battery-staple",
      name: "Fresh User"
    })
    expect(signUp.status).toBe(200)

    const response = await harness.fetch("/api/v1/me", {
      headers: { cookie: cookiesFrom(signUp) }
    })
    expect(response.status).toBe(200)
    const identity = await response.json() as { organization_id: string; role: string }
    // Owner of their own organization: a personal org is theirs, not a shared default.
    expect(identity.role).toBe("owner")
    expect(identity.organization_id.length).toBeGreaterThan(0)
  })

  it("401s a valid session whose membership has been revoked", async () => {
    /*
     * The invariant the test above used to carry, on a state that now has to be made rather than defaulted to.
     *
     * Silently falling back to "their first organization" would be a cross-tenant leak — a user in two
     * organizations would act in whichever the query returned first — so a session with no membership must be
     * refused rather than guessed at. Revocation is the real-world version: a member removed from an
     * organization has to stop being served, which is why `resolveIdentity` re-reads membership every request
     * instead of trusting the session.
     */
    const email = `revoked-${Date.now()}@example.com`
    const signUp = await harness.post("/api/auth/sign-up/email", {
      email,
      password: "correct-horse-battery-staple",
      name: "Revoked User"
    })
    expect(signUp.status).toBe(200)
    const cookie = cookiesFrom(signUp)

    // Works first, so the refusal below is demonstrably caused by the revocation and not by the setup.
    expect((await harness.fetch("/api/v1/me", { headers: { cookie } })).status).toBe(200)

    /*
     * `pg` directly rather than widening the harness with a SQL escape hatch.
     *
     * The harness drives the Worker over HTTP; giving it arbitrary SQL would make it the thing every future
     * test reaches for instead of an endpoint, and a suite that writes rows behind the API stops testing the
     * API. This case genuinely needs a state no endpoint produces, so the escape is local and visible.
     */
    const client = new Client({
      connectionString: process.env["CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE"]
    })
    await client.connect()
    try {
      await client.query(`delete from member where "userId" = (select id from "user" where email = $1)`, [email])
    } finally {
      await client.end()
    }

    const response = await harness.fetch("/api/v1/me", { headers: { cookie } })
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
