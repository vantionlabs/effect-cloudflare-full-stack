/**
 * A fresh account, created out of band.
 *
 * Out of band matters: every spec that signs in must START as a guest, so the account cannot be made by
 * driving the UI in the same browser context — that would leave it signed in and the redirect under test
 * would never fire. Playwright's `request` fixture is a separate cookie jar, which is exactly the tool.
 *
 * It goes through the CONSOLE's origin rather than straight at the API, so the `/api/*` forward in
 * `apps/console/src/server.ts` is exercised on the way in. A helper that bypassed it would still make a
 * user, and would stop telling us the proxy works.
 */
import type { APIRequestContext, Page } from "@playwright/test"
import { expect } from "@playwright/test"

export interface Account {
  readonly email: string
  readonly password: string
  readonly name: string
}

/**
 * Unique per call, because the suite runs against a Postgres that keeps its rows.
 *
 * `user.email` is unique, so a fixed address passes once and then fails with "user already exists" on
 * every later run — including the first CI run after a green local one.
 */
const uniqueEmail = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`

export const createAccount = async (request: APIRequestContext, baseURL: string): Promise<Account> => {
  const account: Account = {
    email: uniqueEmail(),
    // Long enough for better-auth's minimum, and obviously not a real credential.
    password: "e2e-only-password",
    name: "End To End"
  }

  const response = await request.post("/api/auth/sign-up/email", {
    /*
     * `Origin` explicitly, because Playwright's request context does not send one and better-auth refuses
     * a state-changing request whose origin it cannot check — a 403 INVALID_ORIGIN, which is the same
     * failure a deployed sign-up produced here once for a different reason. A browser always sends it; a
     * programmatic client has to be told to.
     */
    headers: { "content-type": "application/json", origin: baseURL },
    data: { email: account.email, password: account.password, name: account.name }
  })

  /*
   * Asserted here rather than left to the spec. A helper that quietly returns an account that was never
   * created turns every spec using it into a confusing failure at the sign-in step, several seconds and
   * one red herring later.
   */
  expect(response.status(), `sign-up failed: ${await response.text()}`).toBe(200)

  return account
}

/** Signs in through the form, which is the only way the console offers. */
export const signIn = async (page: Page, account: Account): Promise<void> => {
  await page.goto("/login?next=%2F")
  await page.getByLabel("Email").fill(account.email)
  await page.getByLabel("Password").fill(account.password)
  await page.getByRole("button", { name: "Sign in" }).click()
  /*
   * Waits for the header, not for the URL. Sign-in ends in a `reloadDocument` navigation, so the URL
   * changes before the new document has been server-rendered — asserting on the URL alone would pass
   * while the page was still the old one.
   *
   * **The timeout is 30 s because the FIRST sign-in in a run pays for a cold dev server.** That navigation
   * is the first request to hit the authenticated route, so vite compiles it on demand and workerd
   * server-renders it for the first time. It took 8.7 s in CI against Playwright's 5 s default, and it was
   * the only one of eight specs to fail — every later `signIn` reuses the compiled route and takes
   * milliseconds, which is exactly the signature of a cold start rather than a product problem.
   *
   * Raised rather than replaced with a sleep: the assertion still has to pass, and a `waitForTimeout` would
   * hide a genuine regression behind a fixed delay — which AGENTS.md says never to do here, because that is
   * how the hydration race was originally masked.
   */
  await expect(page.getByText(account.email)).toBeVisible({ timeout: 30_000 })
}
