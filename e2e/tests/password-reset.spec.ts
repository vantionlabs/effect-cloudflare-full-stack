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
  await page.getByLabel("E-mailadres").fill(`nobody-${Date.now()}@example.test`)
  await page.getByRole("button", { name: "Stuur link" }).click()
  await expect(page.getByRole("status")).toContainText("Als er een account bestaat voor dit adres")
})

test("a reset link better-auth rejected offers a new one instead of a form", async ({ page }) => {
  await page.goto("/reset-password?error=INVALID_TOKEN")
  await expect(page.getByRole("alert")).toContainText("ongeldig of verlopen")
  await expect(page.getByLabel("Nieuw wachtwoord")).toBeHidden()
  await page.getByRole("link", { name: "Vraag een nieuwe aan" }).click()
  await expect(page).toHaveURL("/forgot-password")
})

test("a made-up token is refused by the server before the page is sent, not after a password is typed", async ({ page }) => {
  // The raw HTML, no JavaScript: the server checked the token with better-auth and rendered the refusal.
  const html = await (await page.request.get("/reset-password?token=not-a-real-token")).text()
  expect(html).toContain("ongeldig of verlopen")
  expect(html).not.toContain("Nieuw wachtwoord")

  await page.goto("/reset-password?token=not-a-real-token")
  await expect(page.getByLabel("Nieuw wachtwoord")).toBeHidden()
})

test("sign in links to both new pages", async ({ page }) => {
  await page.goto("/login?next=%2F")
  await expect(page.getByRole("link", { name: "Wachtwoord vergeten?" })).toHaveAttribute("href", "/forgot-password")
  await expect(page.getByRole("link", { name: "Account aanmaken" })).toHaveAttribute("href", "/sign-up?next=%2F")
})
