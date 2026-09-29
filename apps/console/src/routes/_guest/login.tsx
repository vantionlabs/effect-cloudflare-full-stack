/**
 * Sign in. Reached only when there is no session, because `_guest` redirects otherwise.
 *
 * `next` is carried through so signing in resumes wherever the visitor was headed. `_authenticated` puts
 * it there on redirect; without it every sign-in lands on the queue, which is wrong the moment somebody
 * follows a link to a specific decision.
 *
 * Validation is Effect 4's `Schema`, NOT a form library. `@lucas-barake/effect-form` would be the natural
 * fit and PLAN.md names it — but every published version, including `0.26.0-beta.5`, peers on
 * `effect: ^3.19.15` while this repo is on `4.0.0-rc.118`. Using it would put two Effect majors in one
 * bundle, which breaks fiber and Context identity in ways that surface as impossible bugs. PLAN.md
 * anticipated exactly this ("they version independently and can lag v4"). Revisit when it ships for v4.
 */
import { authClient } from "@/auth/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Schema } from "effect"
import { useState } from "react"

/**
 * SHAPE only — deliberately not password policy.
 *
 * `FormData.get` returns `string | File | null`, so something has to establish these are strings before
 * they reach a typed call; that is what a schema is for, and it is the same `Schema` the rest of the repo
 * decodes with.
 *
 * What is NOT here is a minimum length. better-auth owns credential policy in its own config, and a copy
 * in the browser would be a second place to change when it moves — the kind of duplication that ends with
 * a form rejecting a password the server would have accepted. The input types and `required` handle the
 * obvious cases; better-auth's error message handles the rest, and it distinguishes them better than a
 * length check could.
 */
const Credentials = Schema.Struct({
  email: Schema.String,
  password: Schema.String
})

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
    <main className="mx-auto flex min-h-full max-w-sm flex-col justify-center px-4">
      <Card>
        <CardHeader>
          <CardTitle>effect-ai</CardTitle>
          <CardDescription>Sign in to review decisions.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={async (event) => {
              event.preventDefault()
              setError(undefined)

              const form = new FormData(event.currentTarget)
              // `decodeUnknownResult`: Effect 4's Result-returning decoder. No throw, no Either import.
              const parsed = Schema.decodeUnknownResult(Credentials)({
                email: form.get("email"),
                password: form.get("password")
              })
              if (parsed._tag === "Failure") {
                setError("Enter an email address and a password.")
                return
              }

              setBusy(true)
              /*
               * better-auth's own client, posting same-origin to `/api/auth/*` which `src/server.ts`
               * forwards over the service binding. So the cookie is first-party, and the SDK's CSRF
               * handling and error codes come for free rather than being reimplemented.
               */
              const result = await authClient.signIn.email(parsed.success)
              setBusy(false)

              if (result.error === null || result.error === undefined) {
                /*
                 * `reloadDocument`, not a soft navigation. The session cookie was set on THIS response and
                 * the router context was resolved before it existed, so a client navigation would re-run
                 * the guard against the stale Guest context and bounce straight back here.
                 */
                await navigate({ to: next, reloadDocument: true })
              } else {
                /*
                 * better-auth's message, not a generic one: it distinguishes "wrong password" from "email
                 * not verified" from "too many attempts", and a user who cannot tell those apart retries
                 * the wrong thing.
                 */
                setError(result.error.message ?? "Those credentials were not accepted.")
              }
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input id="email" name="email" type="email" required autoComplete="email" />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input id="password" name="password" type="password" required autoComplete="current-password" />
              </Field>
              {error === undefined ? null : <FieldError>{error}</FieldError>}
              <Button type="submit" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
