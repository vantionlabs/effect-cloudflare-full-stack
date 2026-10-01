/**
 * Choose a new password, from the link in a reset email.
 *
 * The token was checked ON THE SERVER before this renders (the route's loader, `api/reset-token.ts`), not trusted
 * from the URL: otherwise `?token=anything` got a working-looking form that failed only after a new password was
 * typed. The check does not spend the token; submitting does, and better-auth checks it again then.
 *
 * Hydration gating and `method="post"` for the same reasons as `login-page.tsx`. The second reason matters more here:
 * a GET submission would put the NEW password in the URL.
 */
import { FieldError, FieldGroup } from "@/components/ui/field"
import { authClient } from "@/features/auth/api/auth-client"
import { useHydrated } from "@/hooks/use-hydrated"
import { useSchemaForm } from "@/hooks/use-schema-form"
import { Link } from "@tanstack/react-router"
import { Schema } from "effect"
import { useState } from "react"
import { authErrorMessage } from "./api/auth-errors.ts"
import { useSessionChange } from "./api/use-session-change.ts"
import { AuthCard, authLinkClass } from "./components/auth-card.tsx"
import { SubmitButton } from "./components/submit-button.tsx"
import { TextField } from "./components/text-field.tsx"

/** Shape only: password policy is better-auth's, and its message is shown verbatim. See `login-page.tsx`. */
const NewPassword = Schema.Struct({ password: Schema.String })

export function ResetPasswordPage(props: { readonly token: string | undefined; readonly valid: boolean }) {
  const leaveSession = useSessionChange()
  const hydrated = useHydrated()
  const [rejected, setRejected] = useState<string | undefined>(undefined)

  const form = useSchemaForm({
    schema: NewPassword,
    defaultValues: { password: "" },
    onSubmit: async ({ password }) => {
      setRejected(undefined)
      const result = await authClient.resetPassword({ newPassword: password, token: props.token ?? "" })
      if (result.error !== null && result.error !== undefined) {
        setRejected(authErrorMessage(result.error, "Deze link is verlopen of al gebruikt. Vraag een nieuwe aan."))
        return
      }
      // The server revokes every session on reset (`revokeSessionsOnPasswordReset`), so this is always a sign-in.
      await leaveSession({ to: "/login", search: { next: "/" } })
    }
  })

  return (
    <AuthCard title="Kies een nieuw wachtwoord" description="De link in je mail is een uur geldig.">
      {!props.valid
        ? (
          <p className="text-sm text-red" role="alert">
            Deze link is ongeldig of verlopen.{" "}
            <Link to="/forgot-password" className={authLinkClass}>Vraag een nieuwe aan</Link>.
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
                  <TextField
                    field={field}
                    label="Nieuw wachtwoord"
                    type="password"
                    autoComplete="new-password"
                    disabled={!hydrated}
                  />
                )}
              </form.Field>
              {rejected === undefined ? null : <FieldError>{rejected}</FieldError>}
              <form.Subscribe selector={(state) => state.isSubmitting}>
                {(isSubmitting) => (
                  <SubmitButton
                    submitting={isSubmitting}
                    hydrated={hydrated}
                    label="Wachtwoord opslaan"
                    busyLabel="Opslaan…"
                  />
                )}
              </form.Subscribe>
            </FieldGroup>
          </form>
        )}
    </AuthCard>
  )
}
