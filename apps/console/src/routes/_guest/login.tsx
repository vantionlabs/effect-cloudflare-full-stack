/**
 * Sign in. Reached only when there is no session, because `_guest` redirects otherwise.
 *
 * `next` is carried through so signing in resumes wherever the visitor was headed. `_authenticated` puts
 * it there on redirect; without it every sign-in lands on the queue, which is wrong the moment somebody
 * follows a link to a specific decision.
 */
import { authClient } from "@/auth/client"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"

export const Route = createFileRoute("/_guest/login")({
  /*
   * Validated rather than read raw. `next` ends up in a redirect, and an unvalidated one is an open
   * redirect — the classic phishing primitive. Only a path is accepted, never an absolute URL, so
   * `?next=https://evil.example` cannot send anyone off-site.
   */
  validateSearch: (search: Record<string, unknown>): { readonly next: string } => {
    const raw = typeof search["next"] === "string" ? search["next"] : "/"
    return { next: raw.startsWith("/") && !raw.startsWith("//") ? raw : "/" }
  },
  component: LoginPage
})

function LoginPage() {
  const { next } = Route.useSearch()
  const navigate = useNavigate()
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">effect-ai</h1>
        <p className="text-muted-foreground mt-1 text-sm">Sign in to review decisions.</p>
      </div>

      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault()
          setBusy(true)
          setError(undefined)
          const form = new FormData(event.currentTarget)
          /*
           * better-auth's own client. It posts same-origin to `/api/auth/*`, which `src/server.ts`
           * forwards to the API over the service binding — so the cookie is first-party and the SDK's
           * error handling, CSRF and future flows all come for free rather than being reimplemented.
           */
          const result = await authClient.signIn.email({
            email: String(form.get("email") ?? ""),
            password: String(form.get("password") ?? "")
          })
          setBusy(false)
          if (result.error === null || result.error === undefined) {
            /*
             * `reloadDocument`, not a client navigation. The session cookie was set on THIS response, and
             * the router's context was resolved before it existed — so a soft navigation would re-run the
             * guard against the stale Guest context and bounce straight back here. A document load
             * re-resolves the session on the server.
             */
            await navigate({ to: next, reloadDocument: true })
          } else {
            /*
             * better-auth's message, not a generic one. It distinguishes "wrong password" from "email not
             * verified" from "too many attempts", and a user who cannot tell those apart retries the wrong
             * thing. The hand-rolled relay this replaced flattened all of them to one sentence.
             */
            setError(result.error.message ?? "Those credentials were not accepted.")
          }
        }}
      >
        <label className="flex flex-col gap-1.5 text-sm">
          Email
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="border-input bg-background rounded-md border px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          Password
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="border-input bg-background rounded-md border px-3 py-2 text-sm"
          />
        </label>
        {error === undefined ? null : <p className="text-destructive text-sm">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="bg-primary text-primary-foreground rounded-md px-3 py-2 text-sm font-medium disabled:opacity-60"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  )
}
