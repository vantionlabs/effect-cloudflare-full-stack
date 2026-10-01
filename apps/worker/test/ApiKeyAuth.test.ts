/**
 * The second door, through the real Worker: a key authenticates a REST request exactly as a cookie does.
 *
 * This is the test the whole API-key design exists to pass — an integrating client with no browser, no session
 * and no cookie jar calling the public API with one header. Everything else here is the negative half: what a
 * revoked key, a wrong key and another organization's key do.
 */
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type Harness, startHarness } from "./Harness.ts"

let harness: Harness

beforeAll(async () => {
  harness = await startHarness()
})

afterAll(async () => {
  await harness?.dispose()
})

/**
 * Issues a key through **better-auth's own route**, which is where key management lives.
 *
 * `metadata.organizationId` is how the key names its tenant: the plugin is configured with
 * `references: "user"`, so the key belongs to the creating user and the organization travels in metadata. It is a
 * CLAIM — what makes it safe is that `IdentityForMember` checks the membership on every request, which the
 * cross-organization test below exercises.
 */
const issueKey = async (cookie: string, organizationId: string, name = "Laravel") => {
  const response = await harness.post(
    "/api/auth/api-key/create",
    { name, metadata: { organizationId } },
    cookie
  )
  expect(response.status).toBe(200)
  const body = await response.json() as { readonly id: string; readonly key: string; readonly start?: string }
  // The plaintext, returned once by the plugin and never again.
  expect(body.key.startsWith("ea_")).toBe(true)
  return body
}

const withKey = (path: string, key: string, init: { method?: string; body?: unknown } = {}) =>
  harness.fetch(path, {
    method: init.method ?? "GET",
    headers: {
      "x-api-key": key,
      origin: harness.origin,
      ...init.body === undefined ? {} : { "content-type": "application/json" }
    },
    ...init.body === undefined ? {} : { body: JSON.stringify(init.body) }
  })

describe("X-API-Key", () => {
  it("authenticates a read with no cookie at all", async () => {
    const { cookie, organizationId } = await harness.signedInWithOrg()
    const issued = await issueKey(cookie, organizationId)

    const response = await withKey("/api/v1/intakes", issued.key)
    expect(response.status).toBe(200)
  })

  it("authenticates a WRITE, which is the point of an integration", async () => {
    const { cookie, organizationId } = await harness.signedInWithOrg()
    const issued = await issueKey(cookie, organizationId)

    const created = await withKey("/api/v1/rooms", issued.key, { method: "POST", body: { name: "From Laravel" } })
    expect(created.status).toBe(201)
    expect((await created.json() as { readonly name: string }).name).toBe("From Laravel")
  })

  it("works as an Authorization: Bearer header too", async () => {
    const { cookie, organizationId } = await harness.signedInWithOrg()
    const issued = await issueKey(cookie, organizationId)

    const response = await harness.fetch("/api/v1/intakes", {
      headers: { authorization: `Bearer ${issued.key}`, origin: harness.origin }
    })
    expect(response.status).toBe(200)
  })

  it("resolves to the SAME organization the issuer was in", async () => {
    const first = await harness.signedInWithOrg()
    const issued = await issueKey(first.cookie, first.organizationId)
    // Something only the first organization can see.
    await harness.fetch(
      "/api/v1/intakes?collection=transactional&filename=bykey.md&content_type=text%2Fmarkdown",
      { method: "POST", headers: { "content-type": "application/octet-stream", cookie: first.cookie }, body: "# x\n" }
    )

    const second = await harness.signedInWithOrg()
    const theirKey = await issueKey(second.cookie, second.organizationId)

    const mine = await (await withKey("/api/v1/intakes", issued.key)).json() as {
      readonly items: ReadonlyArray<unknown>
    }
    const theirs = await (await withKey("/api/v1/intakes", theirKey.key)).json() as {
      readonly items: ReadonlyArray<unknown>
    }

    expect(JSON.stringify(mine)).toContain("bykey.md")
    // The tenancy seam, reached through a credential that never names a tenant.
    expect(JSON.stringify(theirs)).not.toContain("bykey.md")
  })

  it("refuses a revoked key", async () => {
    const { cookie, organizationId } = await harness.signedInWithOrg()
    const issued = await issueKey(cookie, organizationId)

    expect((await withKey("/api/v1/intakes", issued.key)).status).toBe(200)

    const revoked = await harness.post("/api/auth/api-key/delete", { keyId: issued.id }, cookie)
    expect(revoked.status).toBe(200)

    expect((await withKey("/api/v1/intakes", issued.key)).status).toBe(401)
  })

  it("refuses a key that was never issued, and a session token presented as one", async () => {
    const { cookie } = await harness.signedInWithOrg()
    for (const presented of ["ea_definitely-not-a-real-key-aaaaaaaaaaaa", "not-even-shaped-like-one", cookie]) {
      expect((await withKey("/api/v1/intakes", presented)).status).toBe(401)
    }
  })

  /*
   * A wrong key beats a valid cookie, and that is deliberate: an explicit credential is a deliberate act where a
   * cookie is ambient. If a present-but-wrong key silently fell through to the session, a client with a broken
   * key would appear to work and would be writing as whoever was signed in.
   */
  it("does not fall back to the cookie when a key is present and wrong", async () => {
    const { cookie } = await harness.signedInWithOrg()
    const response = await harness.fetch("/api/v1/intakes", {
      headers: { "x-api-key": "ea_wrong-but-well-shaped-aaaaaaaaaaaaaaaa", cookie, origin: harness.origin }
    })
    expect(response.status).toBe(401)
  })
})

describe("key management", () => {
  it("lists keys without ever returning the secret again", async () => {
    const { cookie, organizationId } = await harness.signedInWithOrg()
    const issued = await issueKey(cookie, organizationId, "Visible")

    // GET, not POST: the plugin uses GET for `list` and `get`, POST for `create`, `delete` and `update`.
    const listed = await harness.fetch("/api/auth/api-key/list", { headers: { cookie } })
    expect(listed.status).toBe(200)
    const body = await listed.text()

    expect(body).toContain("Visible")
    // The one assertion that matters most in this file: the plaintext is unrecoverable after issue.
    expect(body).not.toContain(issued.key)
  })

  it("another user cannot delete somebody else's key", async () => {
    // better-auth owns this refusal; asserted because it is the property our tenancy story leans on.
    const first = await harness.signedInWithOrg()
    const issued = await issueKey(first.cookie, first.organizationId)

    const second = await harness.signedInWithOrg()
    const theirs = await harness.post("/api/auth/api-key/delete", { keyId: issued.id }, second.cookie)
    expect(theirs.status).not.toBe(200)

    // And it still works, which is what makes the refusal meaningful.
    expect((await withKey("/api/v1/intakes", issued.key)).status).toBe(200)
  })
})

describe("the per-key quota", () => {
  /*
   * It works, and nothing proved it until now — so "we have per-key quota" rested on a config line.
   *
   * `BetterAuth.ts` sets the api-key plugin's `rateLimit` to 1,000 requests an hour, counted on the
   * `apikey` row. **That means the Durable Object the plan calls "the one place a DO genuinely earns its
   * keep" is not needed here:** better-auth counts per key in Postgres, which IS the accurate accounting
   * Cloudflare's rate-limit binding explicitly is not (per-colo, eventually consistent, 10s/60s windows).
   * A DO would be a second counter disagreeing with this one.
   *
   * A note on how nearly this got written up backwards: the first version of these tests hit
   * `/api/v1/health`, which is PUBLIC — the deploy smoke test calls it with no credentials. So the key was
   * never verified, nothing counted, and the evidence said "the quota does not enforce". It was only caught
   * because an unrelated assertion failed in a way that made no sense. **A quota test has to call an
   * endpoint that actually authenticates**, which is why these use `/api/v1/intakes`.
   */

  /** Lowers one key's ceiling, so the limit is provable in three requests rather than a thousand. */
  const setCeiling = async (keyId: string, max: number) => {
    const client = new Client({
      host: process.env["PGHOST"] ?? "localhost",
      port: Number(process.env["PGPORT"] ?? 55433),
      user: process.env["PGUSER"] ?? "effect_ai",
      password: process.env["PGPASSWORD"] ?? "local_dev_only",
      database: process.env["PGDATABASE"] ?? "effect_ai"
    })
    await client.connect()
    try {
      await client.query(
        `update apikey set "rateLimitMax" = $1, "rateLimitEnabled" = true, "requestCount" = 0,
         "lastRequest" = null where id = $2`,
        [max, keyId]
      )
    } finally {
      await client.end()
    }
  }

  const countFor = async (keyId: string) => {
    const client = new Client({
      host: process.env["PGHOST"] ?? "localhost",
      port: Number(process.env["PGPORT"] ?? 55433),
      user: process.env["PGUSER"] ?? "effect_ai",
      password: process.env["PGPASSWORD"] ?? "local_dev_only",
      database: process.env["PGDATABASE"] ?? "effect_ai"
    })
    await client.connect()
    try {
      const row = await client.query<{ requestCount: number; lastRequest: Date | null }>(
        `select "requestCount", "lastRequest" from apikey where id = $1`,
        [keyId]
      )
      return row.rows[0]!
    } finally {
      await client.end()
    }
  }

  it("refuses the request that exceeds the key's ceiling", async () => {
    const { cookie, organizationId } = await harness.signedInWithOrg()
    const issued = await issueKey(cookie, organizationId)
    await setCeiling(issued.id, 2)

    const statuses = [
      (await withKey("/api/v1/intakes", issued.key)).status,
      (await withKey("/api/v1/intakes", issued.key)).status,
      (await withKey("/api/v1/intakes", issued.key)).status
    ]
    // Two inside the ceiling, the third over it. The ceiling is per KEY, not per account.
    expect(statuses).toEqual([200, 200, 401])
  })

  it("counts every authenticated request on the key's own row", async () => {
    /*
     * The accounting half, and the reason a DO is unnecessary. An exact per-key count that survives a
     * restart is what a contractual "1,000 an hour" needs; a per-colo approximation cannot supply it.
     */
    const { cookie, organizationId } = await harness.signedInWithOrg()
    const issued = await issueKey(cookie, organizationId)
    await setCeiling(issued.id, 1000)

    await withKey("/api/v1/intakes", issued.key)
    await withKey("/api/v1/intakes", issued.key)
    await withKey("/api/v1/intakes", issued.key)

    const after = await countFor(issued.id)
    expect(after.requestCount).toBe(3)
    expect(after.lastRequest).not.toBeNull()
  })

  it("answers 401 for a breach, which is WRONG and is pinned here deliberately", async () => {
    /*
     * The one real defect, asserted as it behaves so the day it is fixed this test fails and points at the
     * decision.
     *
     * The plugin signals a breach by THROWING `APIError TOO_MANY_REQUESTS` with code `RATE_LIMITED`.
     * `SessionStore.verifyApiKey` wraps the call in `orNull`, so the throw becomes `null`, `apiKeyOwner`
     * returns null, and the middleware answers `HttpApiError.Unauthorized`. A caller is told their key is
     * bad when it is fine and they are over quota — and those have opposite remedies. The Laravel consumer
     * this API exists for cannot tell "fix your credentials" from "back off and retry".
     *
     * Fixing it means adding 429 to the `Authenticated` middleware's declared error, which changes the v1
     * OpenAPI document — additive for clients, but a contract change, so a decision rather than a patch.
     * See `.scratch/api-quota/issues/01`.
     */
    const { cookie, organizationId } = await harness.signedInWithOrg()
    const issued = await issueKey(cookie, organizationId)
    await setCeiling(issued.id, 1)

    expect((await withKey("/api/v1/intakes", issued.key)).status).toBe(200)
    const over = await withKey("/api/v1/intakes", issued.key)
    expect(over.status, "should be 429 with Retry-After; it is 401").toBe(401)
  })
})
