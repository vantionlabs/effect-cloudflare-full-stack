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

/** Issues a key the way a client would: once, over the API, with a session. */
const issueKey = async (cookie: string, name = "Laravel") => {
  const response = await harness.fetch("/api/v1/api-keys", {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin: harness.origin },
    body: JSON.stringify({ name })
  })
  expect(response.status).toBe(201)
  return await response.json() as { readonly id: string; readonly key: string; readonly prefix: string }
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
    const { cookie } = await harness.signedInWithOrg()
    const issued = await issueKey(cookie)

    const response = await withKey("/api/v1/intakes", issued.key)
    expect(response.status).toBe(200)
  })

  it("authenticates a WRITE, which is the point of an integration", async () => {
    const { cookie } = await harness.signedInWithOrg()
    const issued = await issueKey(cookie)

    const created = await withKey("/api/v1/rooms", issued.key, { method: "POST", body: { name: "From Laravel" } })
    expect(created.status).toBe(201)
    expect((await created.json() as { readonly name: string }).name).toBe("From Laravel")
  })

  it("works as an Authorization: Bearer header too", async () => {
    const { cookie } = await harness.signedInWithOrg()
    const issued = await issueKey(cookie)

    const response = await harness.fetch("/api/v1/intakes", {
      headers: { authorization: `Bearer ${issued.key}`, origin: harness.origin }
    })
    expect(response.status).toBe(200)
  })

  it("resolves to the SAME organization the issuer was in", async () => {
    const first = await harness.signedInWithOrg()
    const issued = await issueKey(first.cookie)
    // Something only the first organization can see.
    await harness.fetch(
      "/api/v1/intakes?collection=transactional&filename=bykey.md&content_type=text%2Fmarkdown",
      { method: "POST", headers: { "content-type": "application/octet-stream", cookie: first.cookie }, body: "# x\n" }
    )

    const second = await harness.signedInWithOrg()
    const theirKey = await issueKey(second.cookie)

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
    const { cookie } = await harness.signedInWithOrg()
    const issued = await issueKey(cookie)

    expect((await withKey("/api/v1/intakes", issued.key)).status).toBe(200)

    const revoked = await harness.fetch(`/api/v1/api-keys/${issued.id}`, {
      method: "DELETE",
      headers: { cookie, origin: harness.origin }
    })
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
    const { cookie } = await harness.signedInWithOrg()
    const issued = await issueKey(cookie, "Visible")

    const listed = await harness.fetch("/api/v1/api-keys", { headers: { cookie } })
    expect(listed.status).toBe(200)
    const body = await listed.text()

    expect(body).toContain("Visible")
    expect(body).toContain(issued.prefix)
    // The one assertion that matters most in this file.
    expect(body).not.toContain(issued.key)
  })

  it("revoking is idempotent, and a stranger's key is a 404", async () => {
    const first = await harness.signedInWithOrg()
    const issued = await issueKey(first.cookie)

    const revoke = () =>
      harness.fetch(`/api/v1/api-keys/${issued.id}`, {
        method: "DELETE",
        headers: { cookie: first.cookie, origin: harness.origin }
      })
    expect((await revoke()).status).toBe(200)
    expect((await revoke()).status).toBe(200)

    const second = await harness.signedInWithOrg()
    const theirs = await harness.fetch(`/api/v1/api-keys/${issued.id}`, {
      method: "DELETE",
      headers: { cookie: second.cookie, origin: harness.origin }
    })
    expect(theirs.status).toBe(404)
  })
})
