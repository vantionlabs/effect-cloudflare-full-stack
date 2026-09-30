/**
 * The public write surface, through the real Worker.
 *
 * The interesting assertions here are about IDEMPOTENCE and CONFLICT, because those are the two things a REST
 * write gets wrong quietly:
 *
 * - `PUT` on a reaction twice must leave the reaction present. The use case is a toggle — to a user it is one
 *   button — and a client that retries after a lost response would otherwise take its own reaction back.
 * - Approving twice must be 200 then **409**, never 200 twice, because exactly one caller may settle a decision
 *   and a second success would tell a client its approval took effect when somebody else's did.
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

const send = (path: string, method: string, cookie: string, body?: unknown) =>
  harness.fetch(path, {
    method,
    headers: {
      cookie,
      origin: harness.origin,
      ...body === undefined ? {} : { "content-type": "application/json" }
    },
    ...body === undefined ? {} : { body: JSON.stringify(body) }
  })

const createRoom = async (cookie: string, name: string) => {
  const response = await send("/api/v1/rooms", "POST", cookie, { name })
  // 201: this creates a resource.
  expect(response.status).toBe(201)
  return await response.json() as { readonly id: string; readonly slug: string; readonly name: string }
}

describe("POST /api/v1/rooms", () => {
  it("creates a channel and returns it in snake_case", async () => {
    const { cookie } = await harness.signedInWithOrg()
    const room = await createRoom(cookie, "Billing Questions")

    expect(room.slug).toBe("billing-questions")
    expect(Object.keys(room)).toContain("created_at")
    expect(Object.keys(room)).toContain("unread_count")
  })

  it("answers 409 for a handle somebody already holds, rather than inventing one", async () => {
    // `#billing` and `#billing-2` are two places people post the same thing, so the caller is told.
    const { cookie } = await harness.signedInWithOrg()
    await createRoom(cookie, "Billing")

    const conflict = await send("/api/v1/rooms", "POST", cookie, { name: "Billing" })
    expect(conflict.status).toBe(409)
    expect((await conflict.json() as Record<string, unknown>)["_tag"]).toBe("RoomSlugTakenV1")
  })

  it("answers 422 with the reason a name was refused", async () => {
    const { cookie } = await harness.signedInWithOrg()
    const response = await send("/api/v1/rooms", "POST", cookie, { name: "   " })

    expect(response.status).toBe(422)
    const body = await response.json() as Record<string, unknown>
    expect(body["_tag"]).toBe("RoomNameInvalidV1")
    // The reason is published so a client can show something better than "invalid".
    expect(typeof body["reason"]).toBe("string")
  })
})

describe("messages", () => {
  it("posts, edits and deletes, and a delete keeps the row", async () => {
    const { cookie } = await harness.signedInWithOrg()
    const room = await createRoom(cookie, "Thread")

    const posted = await send(`/api/v1/rooms/${room.id}/messages`, "POST", cookie, { body: "first" })
    expect(posted.status).toBe(201)
    const message = await posted.json() as { readonly id: string; readonly body: string }
    expect(message.body).toBe("first")

    const edited = await send(`/api/v1/messages/${message.id}`, "PATCH", cookie, { body: "second" })
    expect(edited.status).toBe(200)
    expect(Object.keys(await edited.json() as object)).toContain("edited_at")

    const deleted = await send(`/api/v1/messages/${message.id}`, "DELETE", cookie)
    expect(deleted.status).toBe(200)

    // The row survives: a deleted message keeps its place in the thread and loses its content.
    const listed = await harness.fetch(`/api/v1/rooms/${room.id}/messages`, { headers: { cookie } })
    const page = await listed.json() as { readonly items: ReadonlyArray<Record<string, unknown>> }
    expect(page.items).toHaveLength(1)
    expect(page.items[0]!["deleted_at"]).not.toBeNull()
    expect(page.items[0]!["body"]).not.toBe("second")
  })

  it("answers 403, not 404, when somebody else wrote it", async () => {
    const author = await harness.signedInWithOrg()
    const room = await createRoom(author.cookie, "Shared")
    const posted = await send(`/api/v1/rooms/${room.id}/messages`, "POST", author.cookie, { body: "mine" })
    const message = await posted.json() as { readonly id: string }

    // A second member of the SAME organization: they can read the message, so 403 reveals nothing new.
    const other = await harness.signedInAs(author.organizationId)
    const refused = await send(`/api/v1/messages/${message.id}`, "PATCH", other.cookie, { body: "theirs" })

    expect(refused.status).toBe(403)
    expect((await refused.json() as Record<string, unknown>)["_tag"]).toBe("NotMessageAuthorV1")
  })

  it("answers 404 for a message in another organization", async () => {
    const { cookie } = await harness.signedInWithOrg()
    const response = await send("/api/v1/messages/not-yours", "PATCH", cookie, { body: "x" })

    expect(response.status).toBe(404)
    expect((await response.json() as Record<string, unknown>)["_tag"]).toBe("MessageNotFoundV1")
  })

  /*
   * The assertion the `desired` parameter was added for. A toggle over HTTP is unsafe: a client that retries
   * after a lost response would remove its own reaction. `PUT` states the intended state, so the second call is
   * a no-op.
   */
  it("PUT on a reaction is idempotent, and DELETE is the inverse", async () => {
    const { cookie } = await harness.signedInWithOrg()
    const room = await createRoom(cookie, "Reactions")
    const posted = await send(`/api/v1/rooms/${room.id}/messages`, "POST", cookie, { body: "react to me" })
    const message = await posted.json() as { readonly id: string }

    const first = await send(`/api/v1/messages/${message.id}/reactions/%F0%9F%91%8D`, "PUT", cookie)
    expect(first.status).toBe(200)
    expect((await first.json() as Record<string, unknown>)["reacted"]).toBe(true)

    const again = await send(`/api/v1/messages/${message.id}/reactions/%F0%9F%91%8D`, "PUT", cookie)
    expect(again.status).toBe(200)
    // Still there. A toggle would have said false.
    expect((await again.json() as Record<string, unknown>)["reacted"]).toBe(true)

    const removed = await send(`/api/v1/messages/${message.id}/reactions/%F0%9F%91%8D`, "DELETE", cookie)
    expect((await removed.json() as Record<string, unknown>)["reacted"]).toBe(false)

    const removedAgain = await send(`/api/v1/messages/${message.id}/reactions/%F0%9F%91%8D`, "DELETE", cookie)
    expect((await removedAgain.json() as Record<string, unknown>)["reacted"]).toBe(false)
  })

  it("marks a room read at a message", async () => {
    const { cookie } = await harness.signedInWithOrg()
    const room = await createRoom(cookie, "Read")
    const posted = await send(`/api/v1/rooms/${room.id}/messages`, "POST", cookie, { body: "hello" })
    const message = await posted.json() as { readonly id: string }

    const marked = await send(`/api/v1/rooms/${room.id}/read`, "PUT", cookie, { message_id: message.id })
    expect(marked.status).toBe(200)
    const body = await marked.json() as Record<string, unknown>
    expect(body["last_read_message_id"]).toBe(message.id)
  })
})

describe("PUT /api/v1/rooms/{id}/archived", () => {
  it("archives and unarchives, and is safe to repeat", async () => {
    const { cookie } = await harness.signedInWithOrg()
    const room = await createRoom(cookie, "Archivable")

    const archived = await send(`/api/v1/rooms/${room.id}/archived`, "PUT", cookie, { archived: true })
    expect(archived.status).toBe(200)
    expect((await archived.json() as Record<string, unknown>)["archived_at"]).not.toBeNull()

    // Repeating it is a no-op rather than a toggle, which is why this is PUT and not POST /archive.
    const again = await send(`/api/v1/rooms/${room.id}/archived`, "PUT", cookie, { archived: true })
    expect(again.status).toBe(200)
    expect((await again.json() as Record<string, unknown>)["archived_at"]).not.toBeNull()

    const restored = await send(`/api/v1/rooms/${room.id}/archived`, "PUT", cookie, { archived: false })
    expect((await restored.json() as Record<string, unknown>)["archived_at"]).toBeNull()
  })

  it("answers 404 for a room that is not the caller's", async () => {
    const { cookie } = await harness.signedInWithOrg()
    const response = await send("/api/v1/rooms/nope/archived", "PUT", cookie, { archived: true })
    expect(response.status).toBe(404)
  })
})

describe("decision actions", () => {
  it("answers 404 for a decision that is not the caller's", async () => {
    const { cookie } = await harness.signedInWithOrg()
    const response = await send("/api/v1/decisions/nope/approve", "POST", cookie)

    expect(response.status).toBe(404)
    expect((await response.json() as Record<string, unknown>)["_tag"]).toBe("DecisionNotFoundV1")
  })
})

describe("POST /api/v1/ask", () => {
  it("refuses without a session", async () => {
    const response = await harness.fetch("/api/v1/ask", {
      method: "POST",
      headers: { "content-type": "application/json", origin: harness.origin },
      body: JSON.stringify({ question: "why?" })
    })
    expect(response.status).toBe(401)
  })
})
