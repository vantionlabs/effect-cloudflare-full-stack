/**
 * ⌘K: from any page, a person types part of an article number and lands on the price list — without a page reload,
 * and with focus back where it was when the palette closes.
 */
import { expect, test } from "@playwright/test"
import { createAccount } from "./support/accounts.ts"

test("the command palette finds a product by part of its SKU and opens the price list", async ({ page, baseURL }) => {
  await createAccount(page.request, baseURL ?? "")
  await page.goto("/sales")
  const sku = page.getByLabel("Artikelnummer")
  await expect(sku).toBeEnabled()
  await sku.fill("PK-23500")
  await page.getByLabel("Productnaam").fill("Hogedrukreiniger PK 23.500")
  await page.getByLabel("Prijs", { exact: true }).fill("1.249,00")
  await page.getByRole("button", { name: "Product toevoegen" }).click()
  await expect(page.getByRole("table", { name: "Producten" })).toContainText("PK-23500")

  // Somewhere else entirely, open the palette from the keyboard.
  await page.goto("/planning")
  await expect(page.getByRole("button", { name: "Zoeken" })).toBeEnabled()
  await page.evaluate(() => {
    ;(window as unknown as { __noReload?: boolean }).__noReload = true
  })
  await page.keyboard.press("ControlOrMeta+k")
  const search = page.getByRole("combobox", { name: "Zoeken" })
  await expect(search).toBeFocused()
  await search.fill("23500")
  await expect(page.getByRole("option", { name: /PK-23500/ })).toBeVisible()
  await search.press("Enter")

  await expect(page).toHaveURL(/\/sales#price-list-heading$/)
  await expect(page.getByRole("dialog", { name: "Zoeken" })).toBeHidden()
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true)
})

test("Esc closes the palette and gives focus back to the button that opened it", async ({ page, baseURL }) => {
  await createAccount(page.request, baseURL ?? "")
  await page.goto("/")
  const button = page.getByRole("button", { name: "Zoeken" })
  await expect(button).toBeEnabled()
  await button.click()
  await expect(page.getByRole("combobox", { name: "Zoeken" })).toBeFocused()
  // Before typing, the palette offers the pages.
  await expect(page.getByRole("option", { name: "Planning" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: "Zoeken" })).toBeHidden()
  await expect(button).toBeFocused()
})
