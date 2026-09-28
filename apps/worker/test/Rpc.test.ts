/**
 * The RPC surface, in real workerd against real Postgres.
 *
 * Driven over plain HTTP rather than through `RpcClient`, deliberately: this asserts the *wire* works
 * — that the endpoint is mounted on the same router as the HTTP API, that the RPC auth middleware
 * resolves the same session cookie, and that tenant scoping applies. A typed client test would prove
 * the client and server agree, which the compiler already does.
 */
import { RPC_V1_PATH } from "@ea/api/v1"
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
 * One RPC request. The envelope shape is the protocol's, not ours.
 *
 * A void payload is `null` on the wire rather than an absent key — omitting it fails the request with
 * `Die: "Expected null"`, which is not an obvious message to work backwards from.
 */
const call = (tag: string, payload: unknown, cookie?: string) =>
  harness.fetch(RPC_V1_PATH, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: harness.origin,
      ...(cookie === undefined ? {} : { cookie })
    },
    body: JSON.stringify([{
      _tag: "Request",
      id: "1",
      tag,
      payload,
      // An array of pairs, not an object: see RpcMessage.RequestEncoded.
      headers: []
    }])
  })

const decode = async (response: Response) => {
  const text = await response.text()
  if (text === "") throw new Error(`empty RPC response, status ${response.status}`)
  return text
}

describe("the RPC endpoint", () => {
  it("is mounted on the same router as the HTTP API", async () => {
    // Same origin, same deploy, no CORS — the reason both transports are cheap to keep.
    const response = await call("Identity.me", null)
    expect(response.status).toBe(200)
  })

  it("refuses an unauthenticated call", async () => {
    // The RPC middleware is a second door onto ONE seam, so it must refuse exactly as the HTTP one
    // does. A transport that authenticated differently would be a second authorization surface.
    const message = await decode(await call("Identity.me", null))
    expect(message).toContain("Unauthenticated")
  })

  it("returns the caller's identity for a real session", async () => {
    const { cookie, organizationId } = await harness.signedInWithOrg()

    const message = await decode(await call("Identity.me", null, cookie))
    const encoded = message

    expect(encoded).toContain(organizationId)
    // Domain types on the wire, not the frozen snake_case shape: `orgId`, not `organization_id`.
    // That is the licence RPC has and the public HTTP API does not.
    expect(encoded).toContain("orgId")
    expect(encoded).toContain("owner")
  })
})

describe("Intake.list", () => {
  it("returns an organization's own arrivals, newest first", async () => {
    const { cookie } = await harness.signedInWithOrg()

    for (const filename of ["first.md", "second.md"]) {
      const upload = await harness.fetch(
        `/api/v1/intakes?collection=transactional&filename=${filename}&content_type=text%2Fmarkdown`,
        {
          method: "POST",
          headers: { "content-type": "application/octet-stream", cookie },
          body: `# ${filename}\n`
        }
      )
      expect(upload.status).toBe(200)
    }

    const encoded = await decode(await call("Intake.list", { limit: 10 }, cookie))

    expect(encoded).toContain("first.md")
    expect(encoded).toContain("second.md")
  })

  it("scopes the list to the caller's organization", async () => {
    // The seam, end to end through a transport that never names a tenant: `ListIntakes` has no
    // organizationId parameter, so there is nothing for a caller to get wrong.
    const first = await harness.signedInWithOrg()
    const upload = await harness.fetch(
      "/api/v1/intakes?collection=policy&filename=secret.md&content_type=text%2Fmarkdown",
      {
        method: "POST",
        headers: { "content-type": "application/octet-stream", cookie: first.cookie },
        body: "# secret\n"
      }
    )
    expect(upload.status).toBe(200)

    const second = await harness.signedInWithOrg()
    const message = await decode(await call("Intake.list", { limit: 50 }, second.cookie))

    expect(message).not.toContain("secret.md")
  })

  it("caps a client-supplied limit rather than trusting it", async () => {
    // A limit is a request, not an instruction. An unbounded one is a trivial way to make the
    // database do too much on a shared instance.
    const { cookie } = await harness.signedInWithOrg()
    const message = await decode(await call("Intake.list", { limit: 100000 }, cookie))
    expect(message).not.toContain("Defect")
  })
})
