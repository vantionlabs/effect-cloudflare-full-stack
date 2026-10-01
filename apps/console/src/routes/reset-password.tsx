/**
 * Choose a new password, from the link in a reset email.
 *
 * **Not under `_guest`, deliberately.** That layout redirects a signed-in visitor to the queue, and somebody who
 * is signed in on this device and clicks a reset link from their inbox would then be bounced away silently with
 * the token still unused. Resetting only needs the token, so the page does not care who is signed in.
 *
 * The token is checked ON THE SERVER before the page renders (`auth/reset-token.ts`), not trusted from the URL:
 * otherwise `?token=anything` got a working-looking form that failed only after a new password was typed. The
 * check does not spend the token; submitting does, and better-auth checks it again then.
 *
 * Hydration gating and `method="post"` for the same reasons as `login.tsx`. The second reason matters more here:
 * a GET submission would put the NEW password in the URL.
 */
import { authClient } from "@/auth/auth-client"
import { checkResetToken } from "@/auth/reset-token"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useHydrated } from "@/hooks/use-hydrated"
import { useSchemaForm } from "@/hooks/use-schema-form"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { Schema } from "effect"
import { useState } from "react"

/** Shape only: password policy is better-auth's, and its message is shown verbatim. See `login.tsx`. */
const NewPassword = Schema.Struct({ password: Schema.String })

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
  component: ResetPasswordPage
})

function ResetPasswordPage() {
  const { token } = Route.useSearch()
  const { valid } = Route.useLoaderData()
  const navigate = useNavigate()
  const hydrated = useHydrated()
  const [rejected, setRejected] = useState<string | undefined>(undefined)

  const form = useSchemaForm({
    schema: NewPassword,
    defaultValues: { password: "" },
    onSubmit: async ({ password }) => {
      setRejected(undefined)
      const result = await authClient.resetPassword({ newPassword: password, token: token ?? "" })
      if (result.error !== null && result.error !== undefined) {
        setRejected(result.error.message ?? "That link has expired or was already used. Request a new one.")
        return
      }
      // The server revokes every session on reset (`revokeSessionsOnPasswordReset`), so this is always a sign-in.
      await navigate({ to: "/login", search: { next: "/" }, reloadDocument: true })
    }
  })

  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-col justify-center px-4">
      <Card>
        <CardHeader>
          <CardTitle>Choose a new password</CardTitle>
          <CardDescription>The link in your email is valid for one hour.</CardDescription>
        </CardHeader>
        <CardContent>
          {!valid
            ? (
              <p className="text-sm" role="alert">
                This reset link is invalid or has expired.{" "}
                <Link to="/forgot-password" className="underline">Request a new one</Link>.
              </p>
            )
            : (
              <form
                method="post"
                onSubmit={(event) => {
                  event.preventDefault()
                  void form.handleSubmit()
                }}
              >
                <FieldGroup>
                  <form.Field name="password">
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor={field.name}>New password</FieldLabel>
                        <Input
                          id={field.name}
                          name={field.name}
                          type="password"
                          autoComplete="new-password"
                          required
                          disabled={!hydrated}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(event) => field.handleChange(event.target.value)}
                        />
                      </Field>
                    )}
                  </form.Field>
                  {rejected === undefined ? null : <FieldError>{rejected}</FieldError>}
                  <form.Subscribe selector={(state) => state.isSubmitting}>
                    {(isSubmitting) => (
                      <Button type="submit" disabled={isSubmitting || !hydrated}>
                        {isSubmitting ? "Saving…" : "Set new password"}
                      </Button>
                    )}
                  </form.Subscribe>
                </FieldGroup>
              </form>
            )}
        </CardContent>
      </Card>
    </main>
  )
}
