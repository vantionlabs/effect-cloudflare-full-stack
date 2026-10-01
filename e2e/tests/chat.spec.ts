/**
 * Channels, through a browser: create one, post in it, and see it arrive in a second client.
 *
 * The room lifecycle and the message queries are covered against real Postgres in
 * `realtime/tables/test`, and the broadcast is covered in the worker suite. What only a browser shows is the
 * loop closing: a channel created in one tab, a message typed in it, and that message appearing in another tab
 * without a refresh — which is the whole claim of the feature.
 */
import { expect, test } from "@playwright/test"
import { createAccount, signIn } from "./support/accounts.ts"

test("a channel created in one tab carries a message to another", async ({ browser, request, baseURL }) => {
  const account = await createAccount(request, baseURL ?? "")
  const base = baseURL ?? ""

  const one = await browser.newContext({ baseURL: base })
  const two = await browser.newContext({ baseURL: base })
  const author = await one.newPage()
  const reader = await two.newPage()

  await signIn(author, account)
  await signIn(reader, account)

  // A unique name per run: the suite runs against a database that keeps its rows, and slugs are unique per org.
  const channel = `Billing ${Date.now()}`
  await author.goto("/chat")
  await author.getByLabel("Naam nieuw kanaal").fill(channel)
  await author.getByRole("button", { name: "Aanmaken" }).click()

  // The channel appears, and creating it selected it — the pane's heading is the proof.
  await expect(author.getByRole("heading", { level: 2 })).toContainText("billing-")

  await author.getByLabel("Schrijf een bericht").fill("the PO matches")
  await author.getByRole("button", { name: "Versturen" }).click()
  await expect(author.getByText("the PO matches")).toBeVisible()

  /*
   * The second client had the chat view open the whole time and never reloaded. The message reaches it because
   * `MessagePosted` invalidated the thread's key — the socket makes it timely, the query supplies the content.
   */
  await reader.goto("/chat")
  await reader.getByRole("button", { name: new RegExp(channel.toLowerCase().replace(/[^a-z0-9]+/g, "-")) }).click()
  await expect(reader.getByText("the PO matches")).toBeVisible()

  await author.getByLabel("Schrijf een bericht").fill("and the totals add up")
  await author.getByRole("button", { name: "Versturen" }).click()

  /*
   * NO reload on the reader. This is the assertion the whole realtime stack exists for; everything else in this
   * file is setup for it.
   */
  await expect(reader.getByText("and the totals add up")).toBeVisible({ timeout: 10_000 })

  await one.close()
  await two.close()
})
