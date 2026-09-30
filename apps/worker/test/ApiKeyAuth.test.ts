/**
 * The second door, through the real Worker: a key authenticates a REST request exactly as a cookie does.
 *
 * This is the test the whole API-key design exists to pass — an integrating client with no browser, no session
 * and no cookie jar calling the public API with one header. Everything else here is the negative half: what a
 * revoked key, a wrong key and another organization's key do.
 */
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
