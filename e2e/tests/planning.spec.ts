/**
 * From a customer's request to cash, in the browser with the real model: the quote is accepted, becomes work in
 * progress, is finished, invoiced and paid — and the planning page moves the same € 457,38 through each stage.
 */
import { expect, test } from "@playwright/test"
import { createAccount } from "./support/accounts.ts"

test("an accepted quote flows through work in progress and invoicing into cash", async ({ page, baseURL }) => {
  test.setTimeout(150_000)
  await createAccount(page.request, baseURL ?? "")

  await page.goto("/sales")
  await expect(page.getByLabel("Artikelnummer")).toBeEnabled()
  await page.getByLabel("Artikelnummer").fill("SV-350")
  await page.getByLabel("Productnaam").fill("Pressure relief valve 350 bar")
  await page.getByLabel("Prijs", { exact: true }).fill("189,00")
  await page.getByRole("button", { name: "Product toevoegen" }).click()
  await expect(page.getByRole("table", { name: "Producten" })).toContainText("SV-350")

  await page.getByLabel("Klantvraag").fill(
    "Hello, please send me a quote for 2 pressure relief valves 350 bar. Regards, Piet Smit (piet@smit-transport.nl)"
  )
  await page.getByRole("button", { name: "Offerte opstellen" }).click()
  const quote = page.getByTestId("quote").first()
  await expect(quote.getByTestId("quote-status")).toHaveText("concept", { timeout: 60_000 })
  await quote.getByRole("button", { name: "Goedkeuren" }).click()
  await quote.getByRole("button", { name: "Naar klant sturen" }).click()
  await expect(quote.getByTestId("quote-status")).toHaveText("verstuurd")
  await quote.getByRole("button", { name: "Klant akkoord" }).click()
  await expect(quote.getByTestId("quote-status")).toHaveText("geaccepteerd")

  await page.goto("/planning")
  await expect(page.getByTestId("wip-open")).toContainText("457,38")
  const job = page.getByTestId("job").first()
  await expect(job.getByRole("button", { name: "Klaar melden" })).toBeEnabled()
  await job.getByRole("button", { name: "Klaar melden" }).click()
  await expect(page.getByTestId("wip-done")).toContainText("457,38")
  await job.getByRole("button", { name: "Factureren" }).click()
  await expect(page.getByTestId("open-invoices")).toContainText("457,38")
  await expect(page.getByRole("table", { name: "Prognose" })).toContainText("457,38")

  await page.getByTestId("invoice").first().getByRole("button", { name: "Betaling vastleggen" }).click()
  await expect(page.getByTestId("open-invoices")).toContainText("0,00")
})

/*
 * An expense is cash out: added, it lowers the net of the week it falls in (on a new account, the only figure that
 * week); stopped, it no longer counts. The amount is typed the Dutch way and must arrive as exact cents.
 */
test("a one-off expense lowers that week's net until it is removed", async ({ page, baseURL }) => {
  await createAccount(page.request, baseURL ?? "")
  await page.goto("/planning")

  const inAWeek = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
  await expect(page.getByLabel("Omschrijving")).toBeEnabled()
  await page.getByLabel("Omschrijving").fill("Workshop rent")
  await page.getByLabel("Bedrag (€)").fill("1.234,56")
  await page.getByLabel("Eerste betaling").fill(inAWeek)
  await page.getByRole("button", { name: "Uitgave toevoegen" }).click()

  const forecast = page.getByRole("table", { name: "Prognose" })
  await expect(page.getByTestId("expense")).toContainText("Workshop rent")
  await expect(forecast).toContainText("-€ 1.234,56")

  await page.getByTestId("expense").getByRole("button", { name: "Verwijderen" }).click()
  await expect(page.getByTestId("expense")).toHaveCount(0)
  await expect(forecast).not.toContainText("-€ 1.234,56")
})
