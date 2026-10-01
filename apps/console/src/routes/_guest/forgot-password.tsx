/**
 * Ask for a password reset link.
 *
 * **The response is the same whether or not the address has an account**, and the page says so rather than
 * "check your email". better-auth already answers identically for both (and simulates the lookup's timing), so
 * a page that said "no account with that email" would have to invent the distinction — and would turn this form
 * into a way of finding out who is a customer.
 *
 * `redirectTo` is ABSOLUTE, built from the page's own origin. better-auth's link goes to its own endpoint, which
 * checks the token and then redirects to `redirectTo?token=…`. A relative path would resolve against the API's
 * origin, which locally is `:8799` rather than this console on `:5173`, and the user would land on a 404 with a
 * valid token in the URL. The origin is trusted on the server (`CONSOLE_ORIGIN` / `ALLOWED_HOSTS`), which is
 * what `originCheck` on that endpoint verifies.
 *
 * Hydration gating and `method="post"` for the same reasons as `login.tsx`, where they are explained.
 */
import { authClient } from "@/auth/auth-client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useHydrated } from "@/hooks/use-hydrated"
import { useSchemaForm } from "@/hooks/use-schema-form"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Schema } from "effect"
import { useState } from "react"

const ResetRequest = Schema.Struct({ email: Schema.String })

export const Route = createFileRoute("/_guest/forgot-password")({ component: ForgotPasswordPage })

function ForgotPasswordPage() {
  const hydrated = useHydrated()
  const [sent, setSent] = useState(false)
  const [rejected, setRejected] = useState<string | undefined>(undefined)

  const form = useSchemaForm({
    schema: ResetRequest,
    defaultValues: { email: "" },
    onSubmit: async ({ email }) => {
      setRejected(undefined)
      const result = await authClient.requestPasswordReset({
        email,
        redirectTo: new URL("/reset-password", window.location.origin).href
      })
      // Only a transport or configuration failure lands here; an unknown address is a success by design.
      if (result.error !== null && result.error !== undefined) {
        setRejected(result.error.message ?? "The request could not be sent. Try again in a moment.")
        return
      }
      setSent(true)
    }
  })

  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-col justify-center px-4">
      <Card>
        <CardHeader>
          <CardTitle>Reset your password</CardTitle>
          <CardDescription>We will email you a link to choose a new one.</CardDescription>
        </CardHeader>
        <CardContent>
          {sent
            ? (
              <p className="text-sm" role="status">
                If an account exists for that address, a reset link is on its way. It expires in an hour.
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
                  <form.Field name="email">
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor={field.name}>Email</FieldLabel>
                        <Input
                          id={field.name}
                          name={field.name}
                          type="email"
                          autoComplete="email"
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
                        {isSubmitting ? "Sending…" : "Send reset link"}
                      </Button>
                    )}
                  </form.Subscribe>
                </FieldGroup>
              </form>
            )}
          <p className="text-muted-foreground mt-4 text-sm">
            <Link to="/login" search={{ next: "/" }} className="hover:underline">Back to sign in</Link>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
