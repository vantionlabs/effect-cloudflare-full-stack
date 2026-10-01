/**
 * `/reset-password` — see `features/auth/reset-password-page.tsx`.
 *
 * **Not under `_guest`, deliberately.** That layout redirects a signed-in visitor to the queue, and somebody who is
 * signed in on this device and clicks a reset link from their inbox would then be bounced away silently with the token
 * still unused. Resetting only needs the token, so the page does not care who is signed in.
 *
 * The loader checks the token ON THE SERVER before the page renders (`features/auth/api/reset-token.ts`).
 */
import { checkResetToken } from "@/features/auth/api/reset-token"
import { ResetPasswordPage } from "@/features/auth/reset-password-page"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search: Record<string, unknown>): { readonly token?: string; readonly error?: string } => ({
    ...typeof search["token"] === "string" ? { token: search["token"] } : {},
    ...typeof search["error"] === "string" ? { error: search["error"] } : {}
  }),
  loaderDeps: ({ search }) => ({ token: search.token, error: search.error }),
  loader: async ({ deps }) =>
    deps.token === undefined || deps.error !== undefined
      ? { valid: false }
      : await checkResetToken({ data: { token: deps.token } }),
  component: ResetPasswordRoute
})

function ResetPasswordRoute() {
  const { token } = Route.useSearch()
  const { valid } = Route.useLoaderData()
  return <ResetPasswordPage token={token} valid={valid} />
}
