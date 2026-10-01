/**
 * Settings, as the owner of a fresh organization: the team, an invitation made and withdrawn, an API key that works
 * exactly until it is revoked, and a rename. Every check reads the page the SERVER sends back after the change —
 * the page re-reads its loader after each mutation — so a change that only lived in local state would fail here.
 */
import { expect, request as playwrightRequest, test } from "@playwright/test"
import { createAccount, signIn } from "./support/accounts.ts"

const unique = (label: string) => `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

test("the team lists the owner, and an invitation is sent, listed and withdrawn", async ({ page, request, baseURL }) => {
  const owner = await createAccount(request, baseURL ?? "")
  await signIn(page, owner)
  await page.goto("/settings")

  const ownerRow = page.getByTestId("member").filter({ hasText: owner.email })
  await expect(ownerRow).toContainText("Eigenaar")
  await expect(ownerRow).toContainText("(jij)")
  // Nobody may remove or demote themselves from here; the controls are not offered.
  await expect(ownerRow.getByRole("button", { name: /Verwijderen/ })).toHaveCount(0)

  const invitee = `${unique("invitee")}@example.test`
  await expect(page.getByLabel("E-mailadres")).toBeEnabled()
  await page.getByLabel("E-mailadres").fill(invitee)
  await page.getByLabel("Rol", { exact: true }).selectOption("reviewer")
  await page.getByRole("button", { name: "Uitnodigen" }).click()
  await expect(page.getByRole("status").filter({ hasText: `Uitnodiging verstuurd naar ${invitee}` })).toBeVisible()

  const invitation = page.getByTestId("invitation").filter({ hasText: invitee })
  await expect(invitation).toContainText("Beoordelaar")
  await expect(invitation).toContainText(owner.email)

  await invitation.getByRole("button", { name: `Intrekken: ${invitee}` }).click()
  await invitation.getByRole("button", { name: "Ja, intrekken" }).click()
  await expect(page.getByTestId("invitation").filter({ hasText: invitee })).toHaveCount(0)
})

test("an API key is shown once, answers the API, and stops working when revoked", async ({ page, request, baseURL }) => {
  const owner = await createAccount(request, baseURL ?? "")
  await signIn(page, owner)
  await page.goto("/settings#api-sleutels")

  const name = unique("key")
  await expect(page.getByLabel("Naam van de sleutel")).toBeEnabled()
  await page.getByLabel("Naam van de sleutel").fill(name)
  await page.getByRole("button", { name: "Sleutel aanmaken" }).click()

  const reveal = page.getByTestId("api-key-reveal")
  await expect(reveal).toContainText("niet meer getoond")
  const secret = (await reveal.locator("code").first().innerText()).trim()
  expect(secret).toMatch(/^ea_/)

  // A separate client with NO cookies, so the key alone is what authenticates.
  const outsider = await playwrightRequest.newContext({ baseURL: baseURL ?? "" })
  const me = await outsider.get("/api/v1/me", { headers: { "x-api-key": secret } })
  expect(me.status(), await me.text()).toBe(200)
  expect(((await me.json()) as { readonly role: string }).role).toBe("owner")

  await reveal.getByRole("button", { name: "Ik heb hem bewaard" }).click()
  await expect(reveal).toHaveCount(0)
  // Listed by its start only; the secret itself is never on the page again.
  const row = page.getByTestId("api-key").filter({ hasText: name })
  await expect(row).toBeVisible()
  await expect(page.getByText(secret)).toHaveCount(0)

  await row.getByRole("button", { name: `Intrekken: ${name}` }).click()
  await row.getByRole("button", { name: "Ja, intrekken" }).click()
  await expect(page.getByTestId("api-key").filter({ hasText: name })).toHaveCount(0)

  const after = await outsider.get("/api/v1/me", { headers: { "x-api-key": secret } })
  expect(after.status()).toBe(401)
  await outsider.dispose()
})

test("the organization can be renamed by its owner", async ({ page, request, baseURL }) => {
  const owner = await createAccount(request, baseURL ?? "")
  await signIn(page, owner)
  await page.goto("/settings#organisatie")

  const renamed = unique("org")
  const field = page.getByLabel("Naam", { exact: true })
  await expect(field).toBeEnabled()
  await field.fill(renamed)
  await page.getByRole("button", { name: "Opslaan" }).click()
  await expect(page.getByRole("status").filter({ hasText: "Naam opgeslagen." })).toBeVisible()

  // From the server, not from the field: the page header after a fresh load names the organization.
  await page.reload()
  await expect(page.getByRole("banner").or(page.locator("header")).first()).toContainText(renamed)
})
