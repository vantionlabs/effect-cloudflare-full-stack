/**
 * Insights with the real model: ask about this month's quotes and get either an answer whose figures are traceable,
 * or a withheld answer — and in both cases the data the tools returned, on the page.
 */
import { expect, test } from "@playwright/test"
import { createAccount } from "./support/accounts.ts"

test("a question about the data is answered from the data, and the data is shown", async ({ page, baseURL }) => {
  test.setTimeout(120_000)
  await createAccount(page.request, baseURL ?? "")

  await page.goto("/insights")
  const question = page.getByLabel("Vraag")
  await expect(question).toBeEnabled()
  await question.fill("How many quotes were created this month, and how many were sent?")
  await page.getByRole("button", { name: "Vraag stellen" }).click()

  await expect(page.getByTestId("data-lookup").first()).toBeVisible({ timeout: 60_000 })
  // Either outcome is legitimate; an error is not.
  await expect(page.getByTestId("data-answer").or(page.getByText("Geen antwoord gegeven"))).toBeVisible()
  await expect(page.getByText("kon niet worden beantwoord")).toBeHidden()
})

/*
 * A cash question, through the planning tool, with the real model. Two tool-schema faults reached the real model
 * unnoticed — an empty parameter object the client refused for the WHOLE toolkit, then a number the model sent as
 * a string — because the scripted model in the unit tests never validates tool schemas. This is the guard.
 */
test("a cash-flow question uses the planning figures and is answered or withheld, never failed", async ({ page, baseURL }) => {
  test.setTimeout(120_000)
  await createAccount(page.request, baseURL ?? "")
  await page.goto("/insights")
  const question = page.getByLabel("Vraag")
  await expect(question).toBeEnabled()
  await question.fill("How much cash do we expect to come in over the next 4 weeks?")
  await page.getByRole("button", { name: "Vraag stellen" }).click()
  await expect(page.getByTestId("data-lookup").first()).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId("data-answer").or(page.getByText("Geen antwoord gegeven"))).toBeVisible()
  await expect(page.getByText("kon niet worden beantwoord")).toBeHidden()
})

/*
 * A Dutch question gets a Dutch answer. The prompt used to ask the model to answer "in the language of the question"
 * and it answered in English anyway; the language is now detected in code and named in the prompt. Checked only
 * when an answer is given — a withheld answer is the product's own text, not the model's.
 */
test("a question in Dutch is answered in Dutch", async ({ page, baseURL }) => {
  test.setTimeout(120_000)
  await createAccount(page.request, baseURL ?? "")
  await page.goto("/insights")
  const question = page.getByLabel("Vraag")
  await expect(question).toBeEnabled()
  await question.fill("Hoeveel offertes zijn er deze maand gemaakt, en hoeveel daarvan zijn verstuurd?")
  await page.getByRole("button", { name: "Vraag stellen" }).click()
  await expect(page.getByTestId("data-lookup").first()).toBeVisible({ timeout: 60_000 })
  const answer = page.getByTestId("data-answer")
  await expect(answer.or(page.getByText("Geen antwoord gegeven"))).toBeVisible()
  if (await answer.isVisible()) {
    const text = (await answer.innerText()).toLowerCase()
    expect(text).toMatch(/\b(de|het|een|zijn|er|deze|maand|offertes)\b/)
    expect(text).not.toMatch(/\b(the|were|this month)\b/)
  }
})
