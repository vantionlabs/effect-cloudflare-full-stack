/**
 * An invitation followed end to end by somebody who has never had an account.
 *
 * This is the path that had no pages until the email work: the link needs a session, a guest is sent to sign in,
 * and a person with no account has to be able to create one WITHOUT losing the invitation on the way. So the
 * assertion that matters most is the last one — after accepting, the session's active organization is the
 * INVITER's, which is what makes the invitation mean anything.
 *
 * The invitation is created through the API rather than by reading an email: the response carries its id, which
 * is exactly what the email's link contains, and the email itself is the console stub's business, not this test's.
 */
import { expect, test } from "@playwright/test"
import { createAccount } from "./support/accounts.ts"

const inviteeEmail = () => `e2e-invitee-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`

test("an invitee with no account signs up from the link and lands in the inviter's organization", async ({ page, request, baseURL }) => {
  const origin = baseURL ?? ""
  // `request` keeps the inviter's session cookie from sign-up, so the invite below is made as them.
  await createAccount(request, origin)
  const email = inviteeEmail()
  const invite = await request.post("/api/auth/organization/invite-member", {
    headers: { "content-type": "application/json", origin },
    data: { email, role: "reviewer" }
  })
  expect(invite.status(), `invite failed: ${await invite.text()}`).toBe(200)
  const invitation = (await invite.json()) as { readonly id: string; readonly organizationId: string }

  // A guest following the link is sent to sign in, with the invitation kept as `next`.
  await page.goto(`/accept-invitation/${invitation.id}`)
  await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(`/accept-invitation/${invitation.id}`)}`))

  // No account yet: sign-up, which must carry `next` through rather than dropping the invitation.
  await page.getByRole("link", { name: "Create an account" }).click()
  await page.getByLabel("Name").fill("Invited Person")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill("e2e-only-password")
  await page.getByRole("button", { name: "Create account" }).click()

  await expect(page).toHaveURL(`/accept-invitation/${invitation.id}`)
  await expect(page.getByText("invited you to")).toBeVisible()
  /*
   * SERVER-rendered, not fetched after hydration: the raw HTML for this URL — no JavaScript run — already names
   * the inviter. The first version loaded it in a `useEffect`, and this assertion is what would catch a return to
   * that, because the HTML would then say "Loading invitation…".
   */
  const html = await (await page.request.get(`/accept-invitation/${invitation.id}`)).text()
  expect(html).toContain("invited you to")
  expect(html).not.toContain("Loading invitation")
  await page.getByRole("button", { name: "Accept" }).click()

  await expect(page).toHaveURL("/")
  await expect(page.getByText(email)).toBeVisible()
  /*
   * The invitee can READ their new organization's data, not merely see their own email. The email comes from
   * better-auth's session; the data needs our identity, which decodes the member's role — and an invitation in a
   * role the product does not know (better-auth's default `member`) signed people in and then 401'd every request.
   */
  const me = await page.request.get("/api/v1/me")
  expect(me.status(), `/api/v1/me: ${await me.text()}`).toBe(200)
  expect(((await me.json()) as { readonly role: string }).role).toBe("reviewer")
  const session = await page.request.get("/api/auth/get-session")
  const body = (await session.json()) as { readonly session: { readonly activeOrganizationId: string | null } }
  expect(body.session.activeOrganizationId).toBe(invitation.organizationId)
})

test("somebody signed in as a different person is told the invitation is not theirs", async ({ page, request, baseURL }) => {
  const origin = baseURL ?? ""
  await createAccount(request, origin)
  const invite = await request.post("/api/auth/organization/invite-member", {
    headers: { "content-type": "application/json", origin },
    data: { email: inviteeEmail(), role: "reviewer" }
  })
  const invitation = (await invite.json()) as { readonly id: string }

  /*
   * A third account opens an invitation addressed to someone else. Created through `page.request`, which SHARES
   * the page's cookie jar — so sign-up has already signed the page in, and a trip through `/login` would be
   * redirected away by `_guest`. (The first version did exactly that and timed out waiting for the form.)
   */
  const stranger = await createAccount(page.request, origin)
  await page.goto("/")
  await expect(page.getByText(stranger.email)).toBeVisible()

  await page.goto(`/accept-invitation/${invitation.id}`)
  await expect(page.getByRole("alert")).toBeVisible()
  // The refusal is in the server's HTML too, decided before the page was sent.
  expect(await (await page.request.get(`/accept-invitation/${invitation.id}`)).text()).toContain("role=\"alert\"")
  await expect(page.getByRole("button", { name: "Accept" })).toBeHidden()
})

test("an invitation in a role the product does not know is refused when it is made", async ({ request, baseURL }) => {
  await createAccount(request, baseURL ?? "")
  const invite = await request.post("/api/auth/organization/invite-member", {
    headers: { "content-type": "application/json", origin: baseURL ?? "" },
    data: { email: inviteeEmail(), role: "member" }
  })
  expect(invite.status()).toBe(400)
})
