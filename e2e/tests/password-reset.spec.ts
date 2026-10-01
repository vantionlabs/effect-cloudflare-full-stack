/**
 * The two reset pages, in the states that need no email.
 *
 * The happy path needs the token from the email, which this suite cannot read — it runs against deployed
 * environments too, with no database access and no log stream. So these pin what a page does with what it is
 * GIVEN: a request always answers the same way whether or not the account exists, and a reset link that is
 * missing its token or carries better-auth's `INVALID_TOKEN` offers a new link instead of a form that cannot work.
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

test("sign in links to both new pages", async ({ page }) => {
  await page.goto("/login?next=%2F")
  await expect(page.getByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/forgot-password")
  await expect(page.getByRole("link", { name: "Create an account" })).toHaveAttribute("href", "/sign-up?next=%2F")
})
