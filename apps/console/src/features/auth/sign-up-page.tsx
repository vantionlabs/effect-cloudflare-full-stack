/**
 * Create an account.
 *
 * Exists for one flow above all: **an invitation to somebody who has no account yet.** The invitation link needs a
 * session, `_authenticated` sends a guest to `/login?next=/accept-invitation/…`, and without this page that person had
 * nowhere to go. `next` is carried through for the same reason it is on the login page, and validated the same way
 * (`api/next-path.ts`) so it cannot become an open redirect.
 *
 * A new account gets a personal organization on creation (`ensureMembership` in `BetterAuth.ts`), so it lands on a
 * working console rather than the "no active organization" notice — and accepting an invitation then switches the
 * active organization to the inviter's.
 *
 * Hydration gating and `method="post"` for the reasons in `login-page.tsx`.
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

/** Shape only. Password policy is better-auth's, and its message is shown verbatim. */
const Registration = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
  password: Schema.String
})

const FIELDS = [
  { name: "name", label: "Naam", type: "text", autoComplete: "name" },
  { name: "email", label: "E-mailadres", type: "email", autoComplete: "email" },
  { name: "password", label: "Wachtwoord", type: "password", autoComplete: "new-password" }
] as const

export function SignUpPage(props: { readonly next: string }) {
  const enterSession = useSessionChange()
  const hydrated = useHydrated()
  const [rejected, setRejected] = useState<string | undefined>(undefined)

  const form = useSchemaForm({
    schema: Registration,
    defaultValues: { name: "", email: "", password: "" },
    onSubmit: async (value) => {
      setRejected(undefined)
      const result = await authClient.signUp.email(value)
      if (result.error !== null && result.error !== undefined) {
        setRejected(authErrorMessage(result.error, "Dit account kon niet worden aangemaakt."))
        return
      }
      // Sign-up signs in, so the router re-reads the session — see `useSessionChange`.
      await enterSession({ to: props.next })
    }
  })

  return (
    <AuthCard
      title="Account aanmaken"
      description="Ben je uitgenodigd? Gebruik dan het e-mailadres waarop je de uitnodiging kreeg."
      footer={
        <p>
          Heb je al een account?{" "}
          <Link to="/login" search={{ next: props.next }} className={authLinkClass}>Inloggen</Link>
        </p>
      }
    >
      <form
        method="post"
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <FieldGroup>
          {FIELDS.map((spec) => (
            <form.Field key={spec.name} name={spec.name}>
              {(field) => (
                <TextField
                  field={field}
                  label={spec.label}
                  type={spec.type}
                  autoComplete={spec.autoComplete}
                  disabled={!hydrated}
                />
              )}
            </form.Field>
          ))}
          {rejected === undefined ? null : <FieldError>{rejected}</FieldError>}
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <SubmitButton
                submitting={isSubmitting}
                hydrated={hydrated}
                label="Account aanmaken"
                busyLabel="Account wordt aangemaakt…"
              />
            )}
          </form.Subscribe>
        </FieldGroup>
      </form>
    </AuthCard>
  )
}
