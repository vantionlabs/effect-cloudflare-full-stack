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
        setRejected(result.error.message ?? "That link has expired or was already used. Request a new one.")
        return
      }
      // The server revokes every session on reset (`revokeSessionsOnPasswordReset`), so this is always a sign-in.
      await leaveSession({ to: "/login", search: { next: "/" } })
    }
  })

  return (
    <AuthCard title="Choose a new password" description="The link in your email is valid for one hour.">
      {!props.valid
        ? (
          <p className="text-sm text-red" role="alert">
            This reset link is invalid or has expired.{" "}
            <Link to="/forgot-password" className={authLinkClass}>Request a new one</Link>.
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
                    label="New password"
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
                    label="Set new password"
                    busyLabel="Saving…"
                  />
                )}
              </form.Subscribe>
            </FieldGroup>
          </form>
        )}
    </AuthCard>
  )
}
