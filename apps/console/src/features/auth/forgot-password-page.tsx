/**
 * Ask for a password reset link.
 *
 * **The response is the same whether or not the address has an account**, and the page says so rather than "check
 * your email". better-auth already answers identically for both (and simulates the lookup's timing), so a page that
 * said "no account with that email" would have to invent the distinction — and would turn this form into a way of
 * finding out who is a customer.
 *
 * `redirectTo` is ABSOLUTE, built from the page's own origin. better-auth's link goes to its own endpoint, which
 * checks the token and then redirects to `redirectTo?token=…`. A relative path would resolve against the API's origin,
 * which locally is `:8799` rather than this console on `:5173`, and the user would land on a 404 with a valid token in
 * the URL. The origin is trusted on the server (`CONSOLE_ORIGIN` / `ALLOWED_HOSTS`), which is what `originCheck` on
 * that endpoint verifies.
 *
 * Hydration gating and `method="post"` for the same reasons as `login-page.tsx`, where they are explained.
 */
import { FieldError, FieldGroup } from "@/components/ui/field"
import { authClient } from "@/features/auth/api/auth-client"
import { useHydrated } from "@/hooks/use-hydrated"
import { useSchemaForm } from "@/hooks/use-schema-form"
import { Link } from "@tanstack/react-router"
import { Schema } from "effect"
import { useState } from "react"
import { AuthCard, authLinkClass } from "./components/auth-card.tsx"
import { SubmitButton } from "./components/submit-button.tsx"
import { TextField } from "./components/text-field.tsx"

const ResetRequest = Schema.Struct({ email: Schema.String })

export function ForgotPasswordPage() {
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
    <AuthCard
      title="Reset your password"
      description="We will email you a link to choose a new one."
      footer={<Link to="/login" search={{ next: "/" }} className={authLinkClass}>Back to sign in</Link>}
    >
      {sent
        ? (
          <p className="text-sm text-ink" role="status">
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
                  <TextField field={field} label="Email" type="email" autoComplete="email" disabled={!hydrated} />
                )}
              </form.Field>
              {rejected === undefined ? null : <FieldError>{rejected}</FieldError>}
              <form.Subscribe selector={(state) => state.isSubmitting}>
                {(isSubmitting) => (
                  <SubmitButton
                    submitting={isSubmitting}
                    hydrated={hydrated}
                    label="Send reset link"
                    busyLabel="Sending…"
                  />
                )}
              </form.Subscribe>
            </FieldGroup>
          </form>
        )}
    </AuthCard>
  )
}
