/**
 * My account: the name and password belong to the person, and a changed password is the one that signs in
 * afterwards. Plus the theme choice, which must survive a reload — the head script reads it before first paint.
 */
import { expect, test } from "@playwright/test"
import { createAccount, signIn } from "./support/accounts.ts"

test("the name and the password are changed, and the new password signs in", async ({ page, request, baseURL }) => {
  const account = await createAccount(request, baseURL ?? "")
  await signIn(page, account)
  await page.goto("/account")
  await expect(page.getByRole("heading", { name: "Mijn account" })).toBeVisible()
  // Outside the dashboard: none of the workspace navigation.
  await expect(page.getByRole("navigation", { name: "Hoofdmenu" })).toHaveCount(0)

  const name = page.getByLabel("Naam")
  await expect(name).toBeEnabled()
  await name.fill("Nieuwe Naam")
  await page.getByRole("button", { name: "Naam opslaan" }).click()
  await expect(page.getByRole("status").filter({ hasText: "Opgeslagen." })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel("Naam")).toHaveValue("Nieuwe Naam")

  const newPassword = "e2e-new-password-2"
  await page.getByLabel("Huidig wachtwoord").fill(account.password)
  await page.getByLabel("Nieuw wachtwoord", { exact: true }).fill(newPassword)
  await page.getByLabel("Herhaal nieuw wachtwoord").fill(newPassword)
  await page.getByRole("button", { name: "Wachtwoord wijzigen" }).click()
  await expect(page.getByRole("status").filter({ hasText: "Wachtwoord gewijzigd." })).toBeVisible()

  await page.getByRole("button", { name: "Uitloggen" }).click()
  await expect(page).toHaveURL(/\/login/)
  await signIn(page, { ...account, password: newPassword })
})

test("the theme choice holds across a reload", async ({ page, request, baseURL }) => {
  const account = await createAccount(request, baseURL ?? "")
  await signIn(page, account)
  await page.goto("/account")

  const dark = page.getByRole("radio", { name: "Donker" })
  await expect(dark).toBeEnabled()
  await dark.click()
  await expect(page.locator("html")).toHaveClass(/\bdark\b/)

  await page.reload()
  await expect(page.locator("html")).toHaveClass(/\bdark\b/)
  await expect(page.getByRole("radio", { name: "Donker" })).toHaveAttribute("aria-checked", "true")

  await page.getByRole("radio", { name: "Licht" }).click()
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/)
})
