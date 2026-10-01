/**
 * Sign in. Reached only when there is no session, because `_guest` redirects otherwise.
 *
 * `next` is carried through so signing in resumes wherever the visitor was headed. `_authenticated` puts it there on
 * redirect; without it every sign-in lands on the queue, which is wrong the moment somebody follows a link to a
 * specific decision.
 *
 * Validation is Effect 4's `Schema`, NOT a form library. `@lucas-barake/effect-form` would be the natural fit and
 * PLAN.md names it — but every published version, including `0.26.0-beta.5`, peers on `effect: ^3.19.15` while this
 * repo is on `4.0.0-rc.118`. Using it would put two Effect majors in one bundle, which breaks fiber and Context
 * identity in ways that surface as impossible bugs. PLAN.md anticipated exactly this ("they version independently and
 * can lag v4"). Revisit when it ships for v4.
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

/**
 * SHAPE only — deliberately not password policy.
 *
 * `FormData.get` returns `string | File | null`, so something has to establish these are strings before they reach a
 * typed call; that is what a schema is for, and it is the same `Schema` the rest of the repo decodes with.
 *
 * What is NOT here is a minimum length. better-auth owns credential policy in its own config, and a copy in the
 * browser would be a second place to change when it moves — the kind of duplication that ends with a form rejecting
 * a password the server would have accepted. The input types and `required` handle the obvious cases; better-auth's
 * error message handles the rest, and it distinguishes them better than a length check could.
 */
const Credentials = Schema.Struct({
  email: Schema.String,
  password: Schema.String
})

export function LoginPage(props: { readonly next: string }) {
  const enterSession = useSessionChange()
  const [rejected, setRejected] = useState<string | undefined>(undefined)
  const hydrated = useHydrated()

  const form = useSchemaForm({
    schema: Credentials,
    defaultValues: { email: "", password: "" },
    onSubmit: async (value) => {
      setRejected(undefined)
      /*
       * better-auth's own client, posting same-origin to `/api/auth/*` which `src/server.ts` forwards over the
       * service binding. The cookie is therefore first-party, and the SDK's CSRF handling and error codes come for
       * free rather than being reimplemented.
       */
      const result = await authClient.signIn.email(value)

      if (result.error !== null && result.error !== undefined) {
        /*
         * better-auth's refusal, not a generic one: it distinguishes "wrong password" from "email not verified" from
         * "too many attempts", and a user who cannot tell those apart retries the wrong thing. Shown in Dutch, mapped
         * by its error CODE so every distinction survives (`api/auth-errors.ts`). Held in local state
         * rather than as a field error, because it belongs to the SUBMISSION — neither field is individually wrong.
         */
        setRejected(authErrorMessage(result.error, "Deze gegevens werden niet geaccepteerd."))
        return
      }

      // The session cookie was set on THIS response; see `useSessionChange` for why the router must re-read it.
      await enterSession({ to: props.next })
    }
  })

  return (
    <AuthCard
      title="Inloggen"
      description="Log in om verder te werken."
      footer={
        <div className="flex justify-between gap-3">
          <Link to="/forgot-password" className={authLinkClass}>Wachtwoord vergeten?</Link>
          {/* `next` carried through, so an invitee who signs up instead still lands on the invitation. */}
          <Link to="/sign-up" search={{ next: props.next }} className={authLinkClass}>Account aanmaken</Link>
        </div>
      }
    >
      {
        /*
         * EVERY control here is disabled until hydration, and not for the obvious reason.
         *
         * These inputs are controlled by form state, so their value comes from React. The server sends real, typeable
         * HTML, and anything typed into it before the client takes over is discarded the moment React hydrates and
         * re-renders from a form state that is still empty. Somebody who starts typing on a cold load watches their
         * email vanish. The e2e suite hit this first, because Playwright types faster than a bundle loads: it filled
         * both fields, React hydrated, and the sign-in submitted nothing at all.
         *
         * Disabling until ready makes the two states honest — the form is either not ready or it works, and never
         * accepts input it is about to throw away.
         *
         * `method="post"` although this form never reaches the server.
         *
         * It is insurance for the window before hydration, when the browser owns this form and React does not. A form
         * with no `method` submits as GET, which appends every field to the URL — and one of these fields is a
         * password. That is how a credential ends up in browser history and in the access log of anything in front of
         * the app. The submit button is disabled until hydration for the same reason, and either measure alone would
         * be enough; both are here because the cost is one word and the failure is one nobody would notice.
         */
      }
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
              <TextField
                field={field}
                label="E-mailadres"
                type="email"
                autoComplete="email"
                disabled={!hydrated}
              />
            )}
          </form.Field>
          <form.Field name="password">
            {(field) => (
              <TextField
                field={field}
                label="Wachtwoord"
                type="password"
                autoComplete="current-password"
                disabled={!hydrated}
              />
            )}
          </form.Field>

          {rejected === undefined ? null : <FieldError>{rejected}</FieldError>}

          {/* Subscribed rather than read from `form.state`, so only the button re-renders while submitting. */}
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <SubmitButton
                submitting={isSubmitting}
                hydrated={hydrated}
                label="Inloggen"
                busyLabel="Bezig met inloggen…"
              />
            )}
          </form.Subscribe>
        </FieldGroup>
      </form>
    </AuthCard>
  )
}
