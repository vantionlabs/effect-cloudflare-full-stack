/**
 * The mechanics' Ask page: server-rendered document list, and a question that reaches a real answer.
 *
 * The second test is the one that matters most. Until 2026-10-01 every question answered 500 in every environment
 * — the agent's client spoke an API Workers AI does not accept — and nothing noticed, because ask had only ever been
 * tested against scripted models. This asks for real, through the UI, and accepts either outcome the product can
 * legitimately give (an answer, or a refusal of an unverifiable one) and nothing else.
 */
import { type APIRequestContext, expect, test } from "@playwright/test"
import { createAccount } from "./support/accounts.ts"

const MANUAL = "# Kraan PK 23.500\n\n## Hydraulische druk\n\nDe maximale werkdruk van het hoofdsysteem is 350 bar.\n"

const uploadManual = async (request: APIRequestContext, origin: string) => {
  const response = await request.post(
    "/api/v1/intakes?collection=knowledge&filename=pk23500.md&content_type=text%2Fmarkdown",
    { headers: { "content-type": "application/octet-stream", origin }, data: MANUAL }
  )
  expect(response.status(), await response.text()).toBe(202)
}

test("lists the documentation in the server-rendered HTML", async ({ page, baseURL }) => {
  await createAccount(page.request, baseURL ?? "")
  await uploadManual(page.request, baseURL ?? "")
  const html = await (await page.request.get("/ask")).text()
  expect(html).toContain("pk23500.md")
})

test("a question reaches the model and comes back as an answer or a refusal, never an error", async ({ page, baseURL }) => {
  test.setTimeout(90_000)
  await createAccount(page.request, baseURL ?? "")
  await uploadManual(page.request, baseURL ?? "")

  await page.goto("/ask")
  await page.getByLabel("Question").fill("Wat is de maximale werkdruk van het hoofdsysteem?")
  await page.getByRole("button", { name: "Ask" }).click()

  const answered = page.getByTestId("answer")
  const refused = page.getByText("No reliable answer")
  await expect(answered.or(refused)).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText("could not be answered")).toBeHidden()
})

test("uploading through the page uses the RPC and the new manual appears in the list", async ({ page, baseURL }) => {
  await createAccount(page.request, baseURL ?? "")
  await page.goto("/ask")
  /*
   * Wait for hydration explicitly. `setInputFiles`, unlike `fill` and `click`, does not wait for the input to be
   * enabled — so it set the file on the server-rendered, disabled input before React attached a handler, and
   * nothing happened. The `disabled={!hydrated}` gate is the signal to wait on (see AGENTS.md), never a sleep.
   */
  const input = page.getByLabel("Upload documentation")
  await expect(input).toBeEnabled()
  await input.setInputFiles({
    name: "service-bulletin-12.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Service bulletin 12\n\n## Slangen\n\nVervang de hogedrukslangen elke 2 jaar.\n")
  })
  await expect(page.getByRole("status")).toContainText("service-bulletin-12.md uploaded", { timeout: 20_000 })
  // The list atom was refreshed, not the page reloaded.
  await expect(page.getByRole("list", { name: "Documents" })).toContainText("service-bulletin-12.md")
})
