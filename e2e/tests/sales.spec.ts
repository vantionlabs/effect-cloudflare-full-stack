/**
 * Sales, end to end in the browser with the real model: add a product, paste a request, get a priced draft,
 * approve it, send it. The assertions are the human boundary and the price: the total is the price list's price,
 * the draft cannot be sent before it is approved (there is no Send button on a draft), and sending marks it sent.
 */
import { expect, test } from "@playwright/test"
import { createAccount } from "./support/accounts.ts"

test("a customer's request becomes a priced draft, is approved by a person, and is sent", async ({ page, baseURL }) => {
  test.setTimeout(120_000)
  await createAccount(page.request, baseURL ?? "")
  await page.goto("/sales")

  // The price list: one product, added through the form.
  const sku = page.getByLabel("SKU")
  await expect(sku).toBeEnabled()
  await sku.fill("SV-350")
  await page.getByLabel("Product name").fill("Pressure relief valve 350 bar")
  await page.getByLabel("Price").fill("189,00")
  await page.getByRole("button", { name: "Add product" }).click()
  await expect(page.getByRole("table", { name: "Products" })).toContainText("SV-350")

  await page.getByLabel("Customer request").fill(
    "Hello, please send me a quote for 2 pressure relief valves 350 bar. Regards, Piet Smit (piet@smit-transport.nl)"
  )
  await page.getByRole("button", { name: "Draft quote" }).click()

  const quote = page.getByTestId("quote").first()
  await expect(quote.getByTestId("quote-status")).toHaveText("draft", { timeout: 60_000 })
  // 2 × € 189,00 = € 378,00, plus 21% VAT = € 457,38 — from the price list, not the model.
  await expect(quote.getByTestId("quote-total")).toContainText("457,38")
  // A draft cannot be sent: the only way forward is a person's approval.
  await expect(quote.getByRole("button", { name: "Send to customer" })).toHaveCount(0)

  await quote.getByRole("button", { name: "Approve" }).click()
  await expect(quote.getByTestId("quote-status")).toHaveText("approved")
  await quote.getByRole("button", { name: "Send to customer" }).click()
  await expect(quote.getByTestId("quote-status")).toHaveText("sent")
})
