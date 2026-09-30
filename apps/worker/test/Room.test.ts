/**
 * The realtime room, through the real upgrade route, in real `workerd`.
 *
 * What is worth testing here is the part no unit test can reach: that the socket authenticates, that the room
 * a client lands in is decided by the SERVER from its session, and that two organizations cannot hear each
 * other. The fan-out itself is three lines; the tenancy is the product.
 *
 * `response.webSocket` is how a Worker returns a socket, and the harness passes it through — which is also the
 * property `apps/console/src/platform/RealtimeHttp.ts` depends on and `HttpServerResponse.fromWeb` would have
 * silently destroyed.
 */
import { expect } from "vitest"
import { afterAll, beforeAll, describe, it } from "vitest"
import { type Harness, startHarness } from "./Harness.ts"

let harness: Harness

beforeAll(async () => {
  harness = await startHarness()
}, 120_000)

afterAll(async () => {
  await harness.dispose()
})

/** Opens an authenticated socket and starts collecting frames immediately. */
const connect = async (cookie: string) => {
  const response = await harness.fetch("/api/v1/realtime", {
    headers: { cookie, Upgrade: "websocket" }
  })
  expect(response.status, `upgrade failed: ${response.status}`).toBe(101)
  const socket = response.webSocket
  expect(socket).toBeDefined()

  const frames: Array<Record<string, unknown>> = []
  /*
   * `event` is left to inference: this is wrangler's Workers-flavoured `WebSocket`, whose listener takes the
   * runtime's own `MessageEvent` and not lib.dom's. Annotating it with the DOM type is what broke the first
   * version — the same class of mistake Harness.ts documents for `Response`.
   */
  socket!.addEventListener("message", (event) => {
    const data = event.data
    if (typeof data === "string" && data !== "pong") {
      frames.push(JSON.parse(data) as Record<string, unknown>)
    }
  })
  // `accept()` on the CLIENT half. The server half was accepted by the room with `acceptWebSocket`, which is
  // what makes it hibernatable; this side is an ordinary client.
  socket!.accept()
  return { socket: socket!, frames }
}

/** Frames arrive asynchronously; poll briefly rather than sleeping a fixed time. */
const waitForFrame = async (
  frames: Array<Record<string, unknown>>,
  tag: string,
  timeoutMs = 5_000
): Promise<Record<string, unknown>> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    /*
     * A reverse scan rather than `findLast`, which needs an ES2023 lib this project does not set. The LAST
     * matching frame is what we want, not the first: presence is sent on every change, so an assertion about
     * "who is here now" must read the newest one.
     */
    const matching = frames.filter((frame) => frame["_tag"] === tag)
    const found = matching.length === 0 ? undefined : matching[matching.length - 1]
    if (found !== undefined) return found
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`no ${tag} frame within ${timeoutMs}ms; saw ${JSON.stringify(frames)}`)
}

describe("GET /api/v1/realtime", () => {
  it("refuses a request with no session", async () => {
    const response = await harness.fetch("/api/v1/realtime", { headers: { Upgrade: "websocket" } })
    /*
     * 401, not a redirect. A WebSocket client cannot follow a redirect — the browser surfaces a failed
     * upgrade — so sending one would be a hang rather than a refusal.
     */
    expect(response.status).toBe(401)
  })

  it("refuses a plain GET that is not an upgrade", async () => {
    const { cookie } = await harness.signedInWithOrg()
    const response = await harness.fetch("/api/v1/realtime", { headers: { cookie } })
    // 426 Upgrade Required: what somebody opening the URL in a browser gets, rather than a 500.
    expect(response.status).toBe(426)
  })

  it("welcomes a new socket with the current viewer list", async () => {
    const { cookie } = await harness.signedInWithOrg()
    const { frames, socket } = await connect(cookie)

    const welcome = await waitForFrame(frames, "Welcome")
    const viewers = welcome["viewers"] as ReadonlyArray<{ email: string; viewing: string | null }>
    expect(viewers).toHaveLength(1)
    expect(viewers[0]?.viewing).toBeNull()

    socket.close()
  })

  it("fans out presence to every socket in the same organization", async () => {
    const { cookie } = await harness.signedInWithOrg()
    const first = await connect(cookie)
    await waitForFrame(first.frames, "Welcome")

    // A second connection for the same tenant lands in the SAME room, because the name is derived from the
    // session rather than from anything the client sends.
    const second = await connect(cookie)

    /*
     * The first socket is TOLD about the second. This is the whole point of a room: the update reaches a
     * connection that was already open, without it asking.
     */
    const presence = await waitForFrame(first.frames, "Presence")
    expect((presence["viewers"] as ReadonlyArray<unknown>).length).toBe(2)

    first.socket.close()
    second.socket.close()
  })

  it("keeps organizations apart, which is the property that matters", async () => {
    const a = await harness.signedInWithOrg()
    const b = await harness.signedInWithOrg()
    expect(a.organizationId).not.toBe(b.organizationId)

    const socketA = await connect(a.cookie)
    const socketB = await connect(b.cookie)

    const welcomeA = await waitForFrame(socketA.frames, "Welcome")
    const welcomeB = await waitForFrame(socketB.frames, "Welcome")

    /*
     * One viewer each, not two. Both sockets are open at the same time against the same Worker and the same
     * Durable Object class — what separates them is only the derived room name, so this is the test that
     * would fail if a room name ever became something a client could influence.
     */
    expect((welcomeA["viewers"] as ReadonlyArray<unknown>).length).toBe(1)
    expect((welcomeB["viewers"] as ReadonlyArray<unknown>).length).toBe(1)

    /*
     * And B never hears about A. Asserted after both are connected, because the failure this guards against
     * is a broadcast reaching the wrong room — which would show up as a Presence frame here.
     */
    expect(socketB.frames.filter((frame) => frame["_tag"] === "Presence")).toHaveLength(0)

    socketA.socket.close()
    socketB.socket.close()
  })

  it("answers a ping without a frame from the application", async () => {
    const { cookie } = await harness.signedInWithOrg()
    const { frames, socket } = await connect(cookie)
    await waitForFrame(frames, "Welcome")

    const pongs: Array<string> = []
    socket.addEventListener("message", (event) => {
      if (event.data === "pong") pongs.push(event.data)
    })
    socket.send("ping")

    /*
     * The reply comes from `setWebSocketAutoResponse`, not from `webSocketMessage` — which is what lets a
     * keepalive arrive without waking a hibernating room. If somebody ever "tidies" the ping into a JSON
     * frame, this still passes only if they also keep the auto-response in step, and the cost of getting it
     * wrong is that every keepalive wakes every room.
     */
    const deadline = Date.now() + 5_000
    while (pongs.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(pongs).toHaveLength(1)

    socket.close()
  })
})
