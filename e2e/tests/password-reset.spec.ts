/**
 * The two reset pages, in the states that need no email.
 *
 * The happy path needs the token from the email, which this suite cannot read — it runs against deployed
 * environments too, with no database access and no log stream. So these pin what a page does with what it is
 * GIVEN: a request always answers the same way whether or not the account exists, and a reset link whose token
 * the SERVER finds unspendable — missing, made up, or flagged `INVALID_TOKEN` by better-auth — offers a new link
 * instead of a form that cannot work.
 */
import { expect, test } from "@playwright/test"

test("requesting a reset answers identically for an address with no account", async ({ page }) => {
  await page.goto("/forgot-password")
  await page.getByLabel("Email").fill(`nobody-${Date.now()}@example.test`)
  await page.getByRole("button", { name: "Send reset link" }).click()
  await expect(page.getByRole("status")).toContainText("If an account exists for that address")
})

test("a reset link better-auth rejected offers a new one instead of a form", async ({ page }) => {
  await page.goto("/reset-password?error=INVALID_TOKEN")
  await expect(page.getByRole("alert")).toContainText("invalid or has expired")
  await expect(page.getByLabel("New password")).toBeHidden()
  await page.getByRole("link", { name: "Request a new one" }).click()
  await expect(page).toHaveURL("/forgot-password")
})

test("a made-up token is refused by the server before the page is sent, not after a password is typed", async ({ page }) => {
  // The raw HTML, no JavaScript: the server checked the token with better-auth and rendered the refusal.
  const html = await (await page.request.get("/reset-password?token=not-a-real-token")).text()
  expect(html).toContain("invalid or has expired")
  expect(html).not.toContain("New password")

  await page.goto("/reset-password?token=not-a-real-token")
  await expect(page.getByLabel("New password")).toBeHidden()
})

test("sign in links to both new pages", async ({ page }) => {
  await page.goto("/login?next=%2F")
  await expect(page.getByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/forgot-password")
  await expect(page.getByRole("link", { name: "Create an account" })).toHaveAttribute("href", "/sign-up?next=%2F")
})
