/**
 * The public read surface, through the real Worker against real Postgres.
 *
 * These are the endpoints that make `POST /intakes` honest: its 202 hands back an `intake_id`, and until now
 * there was no REST way to read what happened next. Driven with `fetch` and a cookie, exactly as an integrating
 * client would — which is the point of testing them here rather than against the schemas.
 *
 * Every response below is checked for **snake_case**, because that is the contract and the wire types now DERIVE
 * their names from the domain's camelCase fields. A rename that slipped through would show up here as a missing
 * key, and in `packages/api/test/OpenApiSnapshot.test.ts` as a diff.
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

const get = (path: string, cookie: string) => harness.fetch(path, { headers: { cookie } })

const upload = (filename: string, cookie: string, collection = "transactional") =>
  harness.fetch(
    `/api/v1/intakes?collection=${collection}&filename=${filename}&content_type=text%2Fmarkdown`,
    { method: "POST", headers: { "content-type": "application/octet-stream", cookie }, body: `# ${filename}\n` }
  )

interface Page {
  readonly items: ReadonlyArray<Record<string, unknown>>
  readonly next_cursor: string | null
}

describe("GET /api/v1/intakes", () => {
  it("returns a page of arrivals in snake_case, with a cursor field", async () => {
    const { cookie } = await harness.signedInWithOrg()
    expect((await upload("arrival.md", cookie)).status).toBe(202)

    const response = await get("/api/v1/intakes", cookie)
    expect(response.status).toBe(200)

    const body = await response.json() as Page
    expect(body.items).toHaveLength(1)
    // The assertion the derived rename exists for: `intakeId` must reach the client as `intake_id`.
    expect(Object.keys(body.items[0]!)).toContain("intake_id")
    expect(Object.keys(body.items[0]!)).toContain("size_bytes")
    expect(Object.keys(body.items[0]!)).not.toContain("intakeId")
    // Present and null, not absent: absent and null are different to a generated client.
    expect(body.next_cursor).toBeNull()
  })

  it("pages, and the cursor it issues is accepted back", async () => {
    const { cookie } = await harness.signedInWithOrg()
    for (const name of ["one.md", "two.md", "three.md"]) expect((await upload(name, cookie)).status).toBe(202)

    const first = await (await get("/api/v1/intakes?limit=2", cookie)).json() as Page
    expect(first.items).toHaveLength(2)
    expect(first.next_cursor).not.toBeNull()

    const second = await (await get(
      `/api/v1/intakes?limit=2&cursor=${encodeURIComponent(first.next_cursor!)}`,
      cookie
    )).json() as Page

    const seen = [...first.items, ...second.items].map((item) => item["filename"])
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen).toHaveLength(3)
  })

  it("answers 400 for a cursor it did not issue, rather than page one", async () => {
    // Silently restarting is how a client reads the first page forever. See `Page.ts`.
    const { cookie } = await harness.signedInWithOrg()
    expect((await get("/api/v1/intakes?cursor=%", cookie)).status).toBe(400)
    // Right shape, wrong collection: two components where this collection wants two is fine, so use one.
    expect((await get("/api/v1/intakes?cursor=onlyonepart", cookie)).status).toBe(400)
  })

  it("refuses without a session", async () => {
    expect((await harness.fetch("/api/v1/intakes")).status).toBe(401)
  })

  it("does not show another organization's arrivals", async () => {
    const first = await harness.signedInWithOrg()
    expect((await upload("private.md", first.cookie)).status).toBe(202)

    const second = await harness.signedInWithOrg()
    const body = await (await get("/api/v1/intakes", second.cookie)).json() as Page
    expect(JSON.stringify(body)).not.toContain("private.md")
  })
})

describe("GET /api/v1/decisions", () => {
  it("returns an empty page rather than a 404 when nothing is queued", async () => {
    const { cookie } = await harness.signedInWithOrg()
    const response = await get("/api/v1/decisions", cookie)

    expect(response.status).toBe(200)
    const body = await response.json() as Page
    expect(body.items).toEqual([])
    expect(body.next_cursor).toBeNull()
  })

  it("accepts the intake_id filter, which is what the 202 is for", async () => {
    const { cookie } = await harness.signedInWithOrg()
    const accepted = await (await upload("filtered.md", cookie)).json() as { readonly intake_id: string }

    // The decide pipeline runs on a queue, so nothing is decided yet — what matters here is that the filter
    // is accepted and scoped, not that it finds a decision.
    const response = await get(`/api/v1/decisions?intake_id=${accepted.intake_id}`, cookie)
    expect(response.status).toBe(200)
    expect((await response.json() as Page).items).toEqual([])
  })

  it("answers a typed 404 for a decision that is not the caller's", async () => {
    const { cookie } = await harness.signedInWithOrg()
    const response = await get("/api/v1/decisions/does-not-exist", cookie)

    expect(response.status).toBe(404)
    // Typed, so a client can branch on it — and it says nothing about WHY, because "belongs to somebody else"
    // and "does not exist" must not be distinguishable.
    const body = await response.json() as Record<string, unknown>
    expect(body["_tag"]).toBe("DecisionNotFoundV1")
    expect(body["decision_id"]).toBe("does-not-exist")
  })
})

describe("GET /api/v1/rooms and its messages", () => {
  it("returns a page of channels in snake_case", async () => {
    const { cookie } = await harness.signedInWithOrg()
    const created = await harness.fetch("/api/rpc/v1", {
      method: "POST",
      headers: { "content-type": "application/json", origin: harness.origin, cookie },
      body: JSON.stringify([{
        _tag: "Request",
        id: "1",
        tag: "Room.create",
        payload: { name: "Billing" },
        headers: []
      }])
    })
    expect(created.status).toBe(200)

    const body = await (await get("/api/v1/rooms", cookie)).json() as Page
    expect(body.items).toHaveLength(1)
    expect(body.items[0]!["name"]).toBe("Billing")
    expect(Object.keys(body.items[0]!)).toContain("unread_count")
    expect(Object.keys(body.items[0]!)).toContain("created_at")
    expect(Object.keys(body.items[0]!)).not.toContain("unreadCount")
    // Not published: it is null for every channel, and a field that is always null is a question a client
    // should not have to ask.
    expect(Object.keys(body.items[0]!)).not.toContain("subject_id")
  })

  it("answers a typed 404 for a room that is not the caller's", async () => {
    const { cookie } = await harness.signedInWithOrg()
    const response = await get("/api/v1/rooms/nope/messages", cookie)

    expect(response.status).toBe(404)
    const body = await response.json() as Record<string, unknown>
    expect(body["_tag"]).toBe("RoomNotFoundV1")
  })
})

describe("the OpenAPI document", () => {
  it("describes every read endpoint it serves", async () => {
    const spec = await (await harness.fetch("/api/v1/openapi.json")).json() as {
      readonly paths: Record<string, unknown>
    }
    for (
      const path of [
        "/api/v1/intakes",
        "/api/v1/decisions",
        "/api/v1/decisions/{decisionId}",
        "/api/v1/rooms",
        "/api/v1/rooms/{roomId}/messages"
      ]
    ) {
      expect(Object.keys(spec.paths)).toContain(path)
    }
  })
})
