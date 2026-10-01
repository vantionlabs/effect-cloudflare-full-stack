import { Button } from "@/components/atoms/Button"
import { authClient } from "@/features/auth/api/auth-client"
import { useHydrated } from "@/hooks/use-hydrated"
import { useNavigate } from "@tanstack/react-router"

export function SignOutButton() {
  const navigate = useNavigate()
  const hydrated = useHydrated()
  return (
    <Button
      variant="secondary"
      size="sm"
      /*
       * Disabled until hydrated, because everything this button does is JavaScript: before that a click is a silent
       * no-op, and the person has been told they signed out when they did not. That is a worse failure than a control
       * that is visibly not ready yet — on a shared machine it is the whole point of the button. The e2e suite found it
       * by clicking faster than the bundle loads, which is also how a real person on a cold connection would.
       */
      disabled={!hydrated}
      onClick={async () => {
        await authClient.signOut()
        /*
         * `reloadDocument` for the same reason sign-in needs it, in reverse: the session was cleared on this response
         * and the router context still holds the Authenticated value resolved before it. A soft navigation would carry
         * the stale context and render the signed-in shell for somebody who is no longer signed in.
         */
        await navigate({ to: "/login", search: { next: "/" }, reloadDocument: true })
      }}
    >
      Uitloggen
    </Button>
  )
}
