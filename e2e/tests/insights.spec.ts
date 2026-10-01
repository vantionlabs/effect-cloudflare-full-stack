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
  const question = page.getByLabel("Question")
  await expect(question).toBeEnabled()
  await question.fill("How many quotes were created this month, and how many were sent?")
  await page.getByRole("button", { name: "Ask" }).click()

  await expect(page.getByTestId("data-lookup").first()).toBeVisible({ timeout: 60_000 })
  // Either outcome is legitimate; an error is not.
  await expect(page.getByTestId("data-answer").or(page.getByText("No answer given"))).toBeVisible()
  await expect(page.getByText("could not be answered")).toBeHidden()
})
