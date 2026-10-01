/**
 * Accept or decline an invitation to an organization — where the invitation email's link lands.
 *
 * Signed in, because both actions need a session: better-auth checks that the signed-in user's email IS the
 * invitation's recipient and refuses otherwise. A guest is sent to `/login?next=…` and comes back here; somebody with
 * no account follows the sign-up link from there, with `next` carried through.
 *
 * Accepting switches the session's active organization to the inviter's (better-auth does that itself, in
 * `accept-invitation`), so the page reloads the document afterwards: the router context and every atom were resolved
 * for the previous organization, and a soft navigation would show the old tenant's queue.
 *
 * The invitation is resolved by the route's LOADER, on the server (`api/invitation.ts`), so the HTML that arrives
 * already names the inviter or says why it cannot be accepted. Only accept and decline run in the browser: they are
 * mutations, and a server-side call carries no `Origin` for better-auth's CSRF check (see `api/auth-client.ts`).
 */
import { Button } from "@/components/atoms/Button"
import { Page, PageHeader, Panel } from "@/components/layout/page"
import { authClient } from "@/features/auth/api/auth-client"
import type { InvitationView } from "@/features/auth/api/invitation"
import { useHydrated } from "@/hooks/use-hydrated"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"

export function AcceptInvitationPage(props: { readonly invitationId: string; readonly invitation: InvitationView }) {
  const { invitation, invitationId } = props
  const navigate = useNavigate()
  const hydrated = useHydrated()
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
    <Page width="narrow">
      <PageHeader
        title="Invitation"
        description={invitation._tag === "Pending"
          ? (
            <>
              {invitation.inviterEmail} invited you to{" "}
              <strong className="text-ink">{invitation.organizationName}</strong> as {invitation.role}.
            </>
          )
          : undefined}
      />
      <Panel>
        {invitation._tag === "Unavailable"
          ? <p className="text-sm text-red" role="alert">{invitation.reason}</p>
          : null}
        {declined ? <p className="text-sm text-ink" role="status">Invitation declined.</p> : null}
        {invitation._tag === "Pending" && !declined
          ? (
            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  disabled={busy || !hydrated}
                  onClick={() => void act("accept")}
                >
                  {busy ? "Working…" : "Accept"}
                </Button>
                <Button variant="secondary" disabled={busy || !hydrated} onClick={() => void act("decline")}>
                  Decline
                </Button>
              </div>
              {rejected === undefined ? null : <p className="text-sm text-red" role="alert">{rejected}</p>}
            </div>
          )
          : null}
      </Panel>
    </Page>
  )
}
