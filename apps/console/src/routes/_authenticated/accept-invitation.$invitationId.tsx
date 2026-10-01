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
 * Fetched in an effect rather than a route loader on purpose. A loader runs during SSR, and SSR auth calls go
 * through the service binding with no `Origin` — fine for this GET, but the accept and decline that follow are
 * mutations and must come from the browser anyway (see `auth-client.ts`), so keeping the whole exchange
 * client-side is the simpler rule.
 */
import { authClient } from "@/auth/auth-client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useHydrated } from "@/hooks/use-hydrated"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect, useState } from "react"

export const Route = createFileRoute("/_authenticated/accept-invitation/$invitationId")({
  component: AcceptInvitationPage
})

type Invitation = { readonly organizationName: string; readonly inviterEmail: string; readonly role: string }

type Load =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Ready"; readonly invitation: Invitation }
  | { readonly _tag: "Unavailable"; readonly reason: string }
  | { readonly _tag: "Declined" }

function AcceptInvitationPage() {
  const { invitationId } = Route.useParams()
  const navigate = useNavigate()
  const hydrated = useHydrated()
  const [load, setLoad] = useState<Load>({ _tag: "Loading" })
  const [busy, setBusy] = useState(false)
  const [rejected, setRejected] = useState<string | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    void authClient.organization.getInvitation({ query: { id: invitationId } }).then((result) => {
      if (cancelled) return
      if (result.data === null || result.data === undefined) {
        // better-auth's message distinguishes "not the recipient" from "expired" from "not found", and the
        // remedy differs for each (sign in as someone else, ask again, check the link), so it is shown as-is.
        setLoad({ _tag: "Unavailable", reason: result.error?.message ?? "This invitation is no longer available." })
        return
      }
      setLoad({
        _tag: "Ready",
        invitation: {
          organizationName: result.data.organizationName,
          inviterEmail: result.data.inviterEmail,
          role: result.data.role
        }
      })
    })
    return () => {
      cancelled = true
    }
  }, [invitationId])

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
      setLoad({ _tag: "Declined" })
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
          {load._tag === "Ready"
            ? (
              <CardDescription>
                {load.invitation.inviterEmail} invited you to <strong>{load.invitation.organizationName}</strong> as
                {" "}
                {load.invitation.role}.
              </CardDescription>
            )
            : null}
        </CardHeader>
        <CardContent>
          {load._tag === "Loading" ? <p className="text-muted-foreground text-sm">Loading invitation…</p> : null}
          {load._tag === "Unavailable" ? <p className="text-sm" role="alert">{load.reason}</p> : null}
          {load._tag === "Declined" ? <p className="text-sm" role="status">Invitation declined.</p> : null}
          {load._tag === "Ready"
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
