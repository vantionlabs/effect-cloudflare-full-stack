/**
 * The realtime socket, through a browser.
 *
 * The room's own behaviour — fan-out, tenancy isolation, the auto-response ping — is covered by
 * `apps/worker/test/Room.test.ts` against a real Worker, which is cheaper and more precise than driving two
 * browsers. What only a browser can show is the part in between: that the page opens the socket at all, that
 * a same-origin upgrade carries the session cookie so it authenticates, and that a frame reaches the client.
 */
import { expect, test } from "@playwright/test"
import { createAccount, signIn } from "./support/accounts.ts"

test("the console opens an authenticated socket and receives the room's welcome", async ({ page, request, baseURL }) => {
  const account = await createAccount(request, baseURL ?? "")

  /*
   * The listener is attached BEFORE signing in, because `Welcome` is sent the instant the room accepts the
   * socket — attaching afterwards is a race the test would lose about half the time.
   */
  const frames: Array<string> = []
  page.on("websocket", (socket) => {
    if (!socket.url().includes("/api/v1/realtime")) return
    socket.on("framereceived", (frame) => frames.push(String(frame.payload)))
  })

  await signIn(page, account)

  await expect.poll(() => frames.filter((frame) => frame.includes("Welcome")).length, {
    timeout: 10_000
  }).toBeGreaterThan(0)

  const welcome = JSON.parse(frames.find((frame) => frame.includes("Welcome")) ?? "{}") as {
    readonly viewers: ReadonlyArray<{ readonly email: string }>
  }

  /*
   * The viewer is the signed-in user, which is the assertion that proves the socket was AUTHENTICATED rather
   * than merely opened. The identity in that frame came from the session cookie on the upgrade request; a
   * socket that had skipped authentication could not know this address.
   */
  expect(welcome.viewers.map((viewer) => viewer.email)).toContain(account.email)
})
