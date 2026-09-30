/**
 * The room's decisions, tested against fakes — no `workerd`, no token, no harness.
 *
 * This file is the reason the logic was lifted out of the Durable Object class. `Room.test.ts` in
 * `apps/worker` proves the socket authenticates and that two organizations cannot hear each other, which needs
 * a real runtime and is gated on `CLOUDFLARE_API_TOKEN`. Everything *below* that — who is in a list, who gets
 * told, when a socket is retired — is arithmetic over attachments, and paying a Worker boot to check it would
 * mean checking it rarely.
 */
import { describe, expect, it } from "vitest"
import {
  announcePresence,
  applyClientFrame,
  attachmentFor,
  broadcastTo,
  identityFromHeaders,
  MAX_SOCKET_AGE_MS,
  type RoomSocket,
  staleSockets,
  viewersOf,
  welcomeFor
} from "../src/Server/index.ts"

/** A socket that records what it was sent. Three methods, because that is all the protocol uses. */
const fakeSocket = (attachment: unknown): RoomSocket & { readonly sent: Array<string> } => {
  let held = attachment
  const sent: Array<string> = []
  return {
    sent,
    send: (message) => sent.push(message),
    close: () => {},
    serializeAttachment: (value) => {
      held = value
    },
    deserializeAttachment: () => held
  }
}

const joined = (email: string, at = 0) => fakeSocket(attachmentFor({ userId: `user-${email}`, email }, at))

describe("viewersOf", () => {
  it("derives the list from attachments, so a disconnected viewer cannot linger", () => {
    const viewers = viewersOf([joined("a@example.test"), joined("b@example.test")])
    expect(viewers.map((viewer) => viewer.email)).toEqual(["a@example.test", "b@example.test"])
  })

  it("omits a socket that is leaving", () => {
    const leaving = joined("gone@example.test")
    expect(viewersOf([joined("stays@example.test"), leaving], leaving).map((viewer) => viewer.email))
      .toEqual(["stays@example.test"])
  })

  it("ignores a socket with no attachment rather than failing", () => {
    /*
     * A socket can exist without one: the platform lists a socket as soon as it is accepted, and the
     * attachment is written immediately after. Throwing here would take down a room because of a race in
     * somebody else's connect.
     */
    expect(viewersOf([fakeSocket(null), joined("real@example.test")])).toHaveLength(1)
  })
})

describe("announcePresence", () => {
  it("includes a joining socket in the list everybody else receives", () => {
    /*
     * The regression test for a real bug. The first version took one `except` socket and used it both to skip
     * a recipient and to omit a viewer, so the second person to connect was INVISIBLE to the first until
     * somebody moved. `skip` and `gone` are now different arguments for that reason.
     */
    const first = joined("first@example.test")
    const joining = joined("second@example.test")

    announcePresence([first, joining], { skip: joining })

    expect(joining.sent).toHaveLength(0)
    expect(first.sent).toHaveLength(1)
    const frame = JSON.parse(first.sent[0]!) as { readonly viewers: ReadonlyArray<{ readonly email: string }> }
    expect(frame.viewers.map((viewer) => viewer.email)).toEqual(["first@example.test", "second@example.test"])
  })

  it("excludes a leaving socket from both the list and the recipients", () => {
    const staying = joined("staying@example.test")
    const leaving = joined("leaving@example.test")

    announcePresence([staying, leaving], { gone: leaving })

    expect(leaving.sent).toHaveLength(0)
    const frame = JSON.parse(staying.sent[0]!) as { readonly viewers: ReadonlyArray<unknown> }
    expect(frame.viewers).toHaveLength(1)
  })
})

describe("broadcastTo", () => {
  it("keeps going when one socket throws", () => {
    /*
     * `getWebSockets` can return a socket in `CLOSING`, and sending to it throws. Without the per-socket
     * catch, the first person to close a tab silently costs everyone else the update.
     */
    const broken: RoomSocket = {
      send: () => {
        throw new Error("closing")
      },
      close: () => {},
      serializeAttachment: () => {},
      deserializeAttachment: () => null
    }
    const healthy = joined("healthy@example.test")

    expect(() => broadcastTo([broken, healthy], "frame")).not.toThrow()
    expect(healthy.sent).toEqual(["frame"])
  })
})

describe("applyClientFrame", () => {
  it("records what a viewer is looking at", () => {
    const socket = joined("a@example.test")
    expect(applyClientFrame(socket, JSON.stringify({ _tag: "Viewing", viewing: "dec_1" }))).toBe(true)
    expect(viewersOf([socket])[0]?.viewing).toBe("dec_1")
  })

  it("drops a frame it cannot read instead of throwing", () => {
    /*
     * The client is the untrusted end. A room is shared, so throwing on one malformed message would take down
     * a connection — or, under the hibernation handlers, the invocation serving several.
     */
    const socket = joined("a@example.test")
    expect(applyClientFrame(socket, "not json at all")).toBe(false)
    expect(applyClientFrame(socket, JSON.stringify({ _tag: "Unknown" }))).toBe(false)
    expect(viewersOf([socket])[0]?.viewing).toBeNull()
  })
})

describe("staleSockets", () => {
  it("retires a socket past the maximum age, so a revoked session stops receiving data", () => {
    const fresh = joined("fresh@example.test", 1_000)
    const old = joined("old@example.test", 0)
    const now = MAX_SOCKET_AGE_MS + 500

    expect(staleSockets([fresh, old], now)).toEqual([old])
  })

  it("keeps a socket that is exactly at the boundary", () => {
    // `<` rather than `<=`, asserted so a later tidy cannot flip it without saying so.
    const socket = joined("edge@example.test", 0)
    expect(staleSockets([socket], MAX_SOCKET_AGE_MS)).toEqual([socket])
    expect(staleSockets([socket], MAX_SOCKET_AGE_MS - 1)).toEqual([])
  })
})

describe("identityFromHeaders", () => {
  it("reads the identity the upgrade route encoded", () => {
    const encoded = JSON.stringify({ userId: "user_1", email: "a@example.test" })
    expect(identityFromHeaders(encoded)).toEqual({ userId: "user_1", email: "a@example.test" })
  })

  it("returns null for a missing or malformed header", () => {
    /*
     * The room cannot verify an identity — it has no database — so the only thing it can do about a bad one is
     * refuse. Returning `null` here is what lets the class answer 500: a request without a valid identity did
     * not come from a client, it came from our own Worker, wrongly.
     */
    expect(identityFromHeaders(null)).toBeNull()
    expect(identityFromHeaders("{}")).toBeNull()
    expect(identityFromHeaders("{\"userId\":\"u\"}")).toBeNull()
  })
})

describe("welcomeFor", () => {
  it("gives a joining socket the whole list, including itself", () => {
    const joining = joined("me@example.test")
    const frame = JSON.parse(welcomeFor([joined("other@example.test"), joining])) as {
      readonly _tag: string
      readonly viewers: ReadonlyArray<{ readonly email: string }>
    }
    expect(frame._tag).toBe("Welcome")
    expect(frame.viewers.map((viewer) => viewer.email)).toContain("me@example.test")
  })
})
