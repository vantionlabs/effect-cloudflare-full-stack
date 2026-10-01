/**
 * The usage page arrives with its numbers in it.
 *
 * A document uploaded through the public API, then the page's RAW server HTML — no JavaScript run — must already
 * show it counted. That pins both halves: the upload path writes the meter, and the page is rendered from a
 * server-side loader rather than filled in after hydration.
 */
import { expect, test } from "@playwright/test"
import { createAccount } from "./support/accounts.ts"

test("an uploaded document is counted on the usage page, in the server-rendered HTML", async ({ page, baseURL }) => {
  // `page.request` shares the page's cookie jar, so creating the account signs the page in.
  await createAccount(page.request, baseURL ?? "")
  const upload = await page.request.post(
    "/api/v1/intakes?collection=transactional&filename=usage.md&content_type=text%2Fmarkdown",
    {
      headers: { "content-type": "application/octet-stream", origin: baseURL ?? "" },
      data: "# Invoice\n\nTotal: EUR 1,00\n"
    }
  )
  expect(upload.status(), await upload.text()).toBe(202)

  const html = await (await page.request.get("/usage")).text()
  // The count may sit inside `RollingDigits`' spans, so markup between the meter's element and the digit is allowed —
  // what matters is that the server's HTML carries the 1, with no JavaScript run.
  expect(html).toMatch(/data-meter="documents\.ingested"[^>]*>(?:<[^>]+>)*1</)

  await page.goto("/usage")
  await expect(page.getByRole("heading", { name: "Verbruik" })).toBeVisible()
  await expect(page.locator("[data-meter=\"decisions.completed\"]")).toBeVisible()
})

/*
 * "Vernieuwen" refetches the report in the browser and the figures update in place — a total that changed rolls to
 * its new value (`RollingDigits`, whose `aria-label` carries the whole number), without reloading the page.
 */
test("refreshing updates a changed total in place", async ({ page, baseURL }) => {
  const origin = baseURL ?? ""
  await createAccount(page.request, origin)
  const upload = (filename: string) =>
    page.request.post(`/api/v1/intakes?collection=transactional&filename=${filename}&content_type=text%2Fmarkdown`, {
      headers: { "content-type": "application/octet-stream", origin },
      data: "# Invoice\n\nTotal: EUR 1,00\n"
    })
  expect((await upload("first.md")).status()).toBe(202)

  await page.goto("/usage")
  const documents = page.locator("[data-meter=\"documents.ingested\"]")
  await expect(documents.getByLabel("1", { exact: true })).toBeVisible()

  expect((await upload("second.md")).status()).toBe(202)
  const refresh = page.getByRole("button", { name: "Vernieuwen" })
  await expect(refresh).toBeEnabled()
  await refresh.click()
  await expect(documents.getByLabel("2", { exact: true })).toBeVisible()
})
