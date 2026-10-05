/**
 * A customer's email becomes a draft quote: the organization creates its address in Settings, an email arrives at the
 * Worker's `email()` handler, and Sales shows it — in the inbox, and as a draft addressed to the sender.
 *
 * The email goes to the API Worker running on its own (`wrangler dev` on :8787, started by playwright.config.ts
 * locally), because the console's dev server routes `/cdn-cgi/local/email` to the console Worker. In CI the suite runs
 * the built preview without that second server, so this spec is skipped there, visibly, with the reason.
 *
 * Drafting reads the email with the REAL model, so it needs Workers AI to answer.
 */
import { type APIRequestContext, expect, test } from "@playwright/test"
import { createAccount } from "./support/accounts.ts"

const EMAIL_URL = process.env.E2E_EMAIL_URL ?? "http://localhost:8787"

const rawEmail = (to: string, messageId: string, subject: string, body: string) =>
  [
    `From: "Piet Smit" <piet@smit-hydrauliek.example>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Message-ID: ${messageId}`,
    `Date: ${new Date().toUTCString()}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
    ""
  ].join("\r\n")

const deliver = (request: APIRequestContext, to: string, raw: string) =>
  request.post(`${EMAIL_URL}/cdn-cgi/local/email?from=piet@smit-hydrauliek.example&to=${encodeURIComponent(to)}`, {
    data: raw,
    headers: { "content-type": "message/rfc822" }
  })

test.skip(
  process.env.CI !== undefined && process.env.E2E_EMAIL_URL === undefined,
  "CI runs the built preview with no standalone API Worker to deliver email to; set E2E_EMAIL_URL to run it."
)

test("an email to the organization's address becomes a draft quote addressed to the sender", async ({ page, baseURL }) => {
  test.setTimeout(120_000)
  await createAccount(page.request, baseURL ?? "")

  // A product the email can be priced against.
  await page.goto("/sales")
  await expect(page.getByLabel("Artikelnummer")).toBeEnabled()
  await page.getByLabel("Artikelnummer").fill("SV-350")
  await page.getByLabel("Productnaam").fill("Overdrukventiel 350 bar")
  await page.getByLabel("Prijs", { exact: true }).fill("189,00")
  await page.getByRole("button", { name: "Product toevoegen" }).click()
  await expect(page.getByRole("table", { name: "Producten" })).toContainText("SV-350")

  // The address, created in Settings.
  await page.goto("/settings")
  await page.getByRole("button", { name: "Adres aanmaken" }).click()
  const tokenHolder = page.getByTestId("inbound-token")
  await expect(tokenHolder).toBeVisible()
  const token = await tokenHolder.getAttribute("data-token")
  expect(token).toMatch(/^[0-9a-z]{10}$/)

  // An unknown address is refused at the door; the organization's own is accepted.
  const unknown = await deliver(page.request, "zzzzzzzzzz@offerte.test", rawEmail("x", "<u@x>", "x", "x"))
  expect(unknown.status()).toBe(400)
  expect(await unknown.text()).toContain("Onbekend adres")

  const subject = `Offerte kleppen ${Date.now()}`
  const accepted = await deliver(
    page.request,
    `${token}@offerte.test`,
    rawEmail(
      `${token}@offerte.test`,
      `<${Date.now()}@smit-hydrauliek.example>`,
      subject,
      "Goedemiddag, graag 2 overdrukventielen 350 bar. Groet, Piet"
    )
  )
  expect(accepted.status(), await accepted.text()).toBe(200)

  // In the inbox at once (server-rendered), then a draft once the queue has read it with the model.
  await page.goto("/sales")
  const row = page.getByTestId("inbound-message").filter({ hasText: subject })
  await expect(row).toBeVisible()
  await expect(async () => {
    await page.getByRole("button", { name: "Vernieuwen" }).click()
    await expect(row.getByTestId("inbound-status")).toHaveText("concept gemaakt", { timeout: 2_000 })
  }).toPass({ timeout: 60_000 })

  const quote = page.getByTestId("quote").filter({ hasText: subject })
  await expect(quote.getByTestId("quote-source")).toContainText(subject)
  await expect(quote).toContainText("piet@smit-hydrauliek.example")
})
