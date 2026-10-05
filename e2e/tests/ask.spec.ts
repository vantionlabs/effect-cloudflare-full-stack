/**
 * The mechanics' Ask page: server-rendered document list, conversations that keep their turns, and a question that
 * reaches a real answer.
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
  const question = page.getByLabel("Vraag", { exact: true })
  await expect(question).toBeEnabled()
  await question.fill("Wat is de maximale werkdruk van het hoofdsysteem?")
  await page.getByRole("button", { name: "Vraag stellen" }).click()

  const answered = page.getByTestId("answer")
  const refused = page.getByTestId("refused-turn")
  await expect(answered.or(refused)).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole("alert")).toBeHidden()
})

/*
 * The conversation is the feature: a follow-up is asked IN it, the page's URL becomes the conversation, and a reload
 * brings back every turn with its sources — server-rendered from the agent's record, not re-asked. The model's
 * wording is not asserted (it is a real model); what is asserted is that turns, their order and their sources survive.
 */
test("a conversation keeps its turns and sources across a reload, is listed, and can be archived", async ({ page, baseURL }) => {
  test.setTimeout(180_000)
  await createAccount(page.request, baseURL ?? "")
  await uploadManual(page.request, baseURL ?? "")

  await page.goto("/ask")
  const question = page.getByLabel("Vraag", { exact: true })
  await expect(question).toBeEnabled()
  await question.fill("Wat is de maximale werkdruk van het hoofdsysteem van de PK 23.500?")
  await page.getByRole("button", { name: "Vraag stellen" }).click()

  // The first answer moves the page to the conversation's own URL.
  await expect(page).toHaveURL(/\/ask\/[A-Za-z0-9_-]+$/, { timeout: 60_000 })
  const turns = page.getByTestId("conversation-turn")
  await expect(turns).toHaveCount(1)

  await expect(question).toBeEnabled()
  await question.fill("En in welke eenheid staat die druk?")
  await page.getByRole("button", { name: "Vraag stellen" }).click()
  await expect(turns).toHaveCount(2, { timeout: 60_000 })

  const answeredBefore = await page.getByTestId("answer").count()
  await page.reload()
  await expect(turns).toHaveCount(2)
  await expect(turns.nth(0)).toContainText("Wat is de maximale werkdruk")
  await expect(turns.nth(1)).toContainText("En in welke eenheid")
  // Answers keep their sources after the reload: the newest one opens them, and they quote the manual.
  expect(await page.getByTestId("answer").count()).toBe(answeredBefore)
  if (answeredBefore > 0) {
    await expect(page.getByText("350 bar").first()).toBeVisible()
  }
  // The whole thread is in the server's HTML — not fetched again after load.
  const html = await (await page.request.get(page.url())).text()
  expect(html).toContain("En in welke eenheid staat die druk?")

  // Listed, newest first, titled by the first question; archiving takes it off the list.
  const list = page.getByRole("list", { name: "Eerdere gesprekken" })
  await expect(list).toContainText("Wat is de maximale werkdruk")
  await page.getByRole("button", { name: /Gesprek archiveren: Wat is de maximale werkdruk/ }).click()
  await expect(page).toHaveURL(/\/ask\/?$/)
  await expect(page.getByText("Je gesprekken worden hier bewaard")).toBeVisible()
})

test("uploading through the page uses the RPC and the new manual appears in the list", async ({ page, baseURL }) => {
  await createAccount(page.request, baseURL ?? "")
  await page.goto("/ask")
  /*
   * Wait for hydration explicitly. `setInputFiles`, unlike `fill` and `click`, does not wait for the input to be
   * enabled — so it set the file on the server-rendered, disabled input before React attached a handler, and
   * nothing happened. The `disabled={!hydrated}` gate is the signal to wait on (see AGENTS.md), never a sleep.
   */
  const input = page.getByLabel("Documentatie uploaden")
  await expect(input).toBeEnabled()
  await input.setInputFiles({
    name: "service-bulletin-12.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Service bulletin 12\n\n## Slangen\n\nVervang de hogedrukslangen elke 2 jaar.\n")
  })
  await expect(page.getByRole("status")).toContainText("service-bulletin-12.md is geüpload", { timeout: 20_000 })
  // The list atom was refreshed, not the page reloaded.
  await expect(page.getByRole("list", { name: "Documenten" })).toContainText("service-bulletin-12.md")
})
