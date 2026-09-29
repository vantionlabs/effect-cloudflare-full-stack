/**
 * The auth boundary, through a browser.
 *
 * Four properties, each of which has been broken here at least once and none of which a unit test can see.
 */
import { expect, test } from "@playwright/test"
import { createAccount, signIn } from "./support/accounts.ts"

test("a guest is redirected to sign in, and where they were going is kept", async ({ page }) => {
  const response = await page.goto("/")

  await expect(page).toHaveURL("/login?next=%2F")

  /*
   * The STATUS is the point, not just the destination.
   *
   * A 307 from the server means `beforeLoad` refused the route before any HTML existed. A 200 with a
   * client-side bounce would satisfy the URL assertion above and would mean the opposite: that the
   * authenticated shell was sent to an anonymous visitor and then corrected. That is the flicker the move
   * to TanStack Start was for, so it is worth asserting rather than assuming.
   */
  const initial = response?.request().redirectedFrom()
  expect(initial, "the navigation should have been redirected by the server").not.toBeNull()
  expect((await initial?.response())?.status()).toBe(307)
})

test("signing in reaches the console and shows who you are", async ({ page, request, baseURL }) => {
  const account = await createAccount(request, baseURL ?? "")

  await signIn(page, account)

  await expect(page).toHaveURL("/")
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible()
  /*
   * A personal organization is created on session creation, so the tenant is set and the console renders
   * the queue rather than the "no active organization" dead end. If this assertion ever fails, the
   * `databaseHooks.session.create.after` hook stopped setting `activeOrganizationId` — and that is worth
   * catching here, because the symptom in production is a console that looks signed in and shows nothing.
   */
  await expect(page.getByText("no active organization")).toBeHidden()
})

test("signing out clears the session, not just the screen", async ({ page, request, baseURL }) => {
  const account = await createAccount(request, baseURL ?? "")
  await signIn(page, account)

  await page.getByRole("button", { name: "Sign out" }).click()
  await expect(page).toHaveURL(/\/login/)

  /*
   * The second half is what makes this test worth writing. Landing on the login page only proves a
   * navigation happened; a stale cookie would still be sent, and going back to `/` would let the visitor
   * straight back in. Asking for `/` again is the only way to observe that the session is really gone.
   */
  await page.goto("/")
  await expect(page).toHaveURL(/\/login/)
})

test("the page sent to the browser carries the session's data but not its token", async ({ page, request, baseURL }) => {
  const account = await createAccount(request, baseURL ?? "")
  await signIn(page, account)

  const cookies = await page.context().cookies()
  const sessionCookie = cookies.find((cookie) => cookie.name.includes("session_token"))
  expect(sessionCookie, "expected a session cookie after signing in").toBeDefined()

  /*
   * better-auth signs the cookie, so its value is `<token>.<signature>`. The token is the first part, and
   * it is the part that would be a bearer credential if it leaked.
   */
  const token = decodeURIComponent(sessionCookie?.value ?? "").split(".")[0] ?? ""
  expect(token.length).toBeGreaterThan(8)

  const response = await page.goto("/")
  const html = await (response?.text() ?? Promise.resolve(""))

  /*
   * This is the assertion that guards `apps/console/src/auth/current-session.ts`.
   *
   * The session is resolved on the server and handed to routes through router context, and TanStack Start
   * SERIALISES that context into the document so the client can hydrate without re-fetching. So anything
   * on the Authenticated branch is printed into the HTML. The type there is deliberately a `Pick` of
   * better-auth's session rather than the session itself, because the session includes `token`, and
   * spreading it would publish a live session token in the page source — defeating the `HttpOnly` cookie
   * whose whole purpose is that scripts cannot read it.
   *
   * Both halves are needed. Without the first, a payload that happened to be empty would pass and prove
   * nothing; without the second, a future `...data.session` would pass silently.
   */
  expect(html).toContain(account.email)
  expect(html, "a session token must never be serialised into the page").not.toContain(token)
})

test("credentials the server refuses are reported, on the page, in its own words", async ({ page }) => {
  await page.goto("/login?next=%2F")
  await page.getByLabel("Email").fill("nobody@example.test")
  await page.getByLabel("Password").fill("not-the-right-password")
  await page.getByRole("button", { name: "Sign in" }).click()

  /*
   * better-auth's message, not one of ours. The form deliberately carries no minimum-length or
   * emptiness rules — credential policy lives in the API's better-auth config, and a copy in the browser
   * would be a second place to change. So the message a user sees for a bad password necessarily comes
   * from the server, and this is the only tier that can check it arrives and gets rendered.
   *
   * The exact string, not a pattern. The first version of this matched `/invalid|password/i`, which also
   * matches the "Password" field label — so it passed whether or not an error rendered at all, and it did
   * exactly that for one run. A test whose assertion is satisfied by the page's furniture is worse than no
   * test, because it reports that something works.
   */
  await expect(page.getByText("Invalid email or password")).toBeVisible()
  await expect(page).toHaveURL("/login?next=%2F")
})

test("with JavaScript off, the form cannot submit a password at all", async ({ browser, baseURL }) => {
  /*
   * A context with scripting disabled IS the pre-hydration state, deterministically — no sleeps, no racing
   * the bundle. This is the regression guard for a real bug this suite found by accident: the e2e helper
   * clicked before hydration, the browser submitted the form itself, and because a form with no `method`
   * submits as GET, the password was appended to the URL — into history and into every access log in
   * front of the app.
   *
   * Two independent measures now prevent it, and this asserts both: the button is disabled until hydrated,
   * and the form is `method="post"` so even a submit from somewhere else cannot put fields in a URL.
   */
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL: baseURL ?? "" })
  const page = await context.newPage()
  await page.goto("/login?next=%2F")

  await expect(page.getByRole("button", { name: "Sign in" })).toBeDisabled()
  /*
   * The fields too, not only the button. A controlled input re-renders from form state on hydration, so
   * anything typed before that is thrown away — which is how this was found: Playwright filled the form
   * faster than the bundle loaded, React hydrated, and the sign-in submitted nothing at all.
   */
  await expect(page.getByLabel("Email")).toBeDisabled()
  await expect(page.getByLabel("Password")).toBeDisabled()
  await expect(page.locator("form")).toHaveAttribute("method", "post")

  await context.close()
})
