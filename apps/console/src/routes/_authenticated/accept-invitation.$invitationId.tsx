/**
 * Accept or decline an invitation to an organization — where the invitation email's link lands.
 *
 * Under `_authenticated` because both actions need a session: better-auth checks that the signed-in user's email
 * IS the invitation's recipient and refuses otherwise. A guest is sent to `/login?next=…` and comes back here;
 * somebody with no account follows the sign-up link from there, with `next` carried through.
 *
 * Accepting switches the session's active organization to the inviter's (better-auth does that itself, in
 * `accept-invitation`), so the page reloads the document afterwards: the router context and every atom were
 * resolved for the previous organization, and a soft navigation would show the old tenant's queue.
 *
 * The invitation is resolved by the route's LOADER, on the server (`auth/invitation.ts`), so the HTML that arrives
 * already names the inviter or says why it cannot be accepted. Only accept and decline run in the browser: they
 * are mutations, and a server-side call carries no `Origin` for better-auth's CSRF check (see `auth-client.ts`).
 */
import { authClient } from "@/auth/auth-client"
import { getInvitation } from "@/auth/invitation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useHydrated } from "@/hooks/use-hydrated"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"

export const Route = createFileRoute("/_authenticated/accept-invitation/$invitationId")({
  loader: ({ params }) => getInvitation({ data: { invitationId: params.invitationId } }),
  component: AcceptInvitationPage
})

function AcceptInvitationPage() {
  const { invitationId } = Route.useParams()
  const navigate = useNavigate()
  const hydrated = useHydrated()
  const invitation = Route.useLoaderData()
  const [declined, setDeclined] = useState(false)
  const [busy, setBusy] = useState(false)
  const [rejected, setRejected] = useState<string | undefined>(undefined)

  const act = async (action: "accept" | "decline") => {
    setBusy(true)
    setRejected(undefined)
    const result = action === "accept"
      ? await authClient.organization.acceptInvitation({ invitationId })
      : await authClient.organization.rejectInvitation({ invitationId })
    if (result.error !== null && result.error !== undefined) {
      setRejected(result.error.message ?? "That did not work. The invitation may have expired.")
      setBusy(false)
      return
    }
    if (action === "decline") {
      setDeclined(true)
      setBusy(false)
      return
    }
    await navigate({ to: "/", reloadDocument: true })
  }

  return (
    <main className="mx-auto flex max-w-sm flex-col px-4 py-16">
      <Card>
        <CardHeader>
          <CardTitle>Invitation</CardTitle>
          {invitation._tag === "Pending"
            ? (
              <CardDescription>
                {invitation.inviterEmail} invited you to <strong>{invitation.organizationName}</strong> as{" "}
                {invitation.role}.
              </CardDescription>
            )
            : null}
        </CardHeader>
        <CardContent>
          {invitation._tag === "Unavailable" ? <p className="text-sm" role="alert">{invitation.reason}</p> : null}
          {declined ? <p className="text-sm" role="status">Invitation declined.</p> : null}
          {invitation._tag === "Pending" && !declined
            ? (
              <div className="flex flex-col gap-3">
                <div className="flex gap-2">
                  <Button disabled={busy || !hydrated} onClick={() => void act("accept")}>
                    {busy ? "Working…" : "Accept"}
                  </Button>
                  <Button variant="outline" disabled={busy || !hydrated} onClick={() => void act("decline")}>
                    Decline
                  </Button>
                </div>
                {rejected === undefined ? null : <p className="text-destructive text-sm" role="alert">{rejected}</p>}
              </div>
            )
            : null}
        </CardContent>
      </Card>
    </main>
  )
}
