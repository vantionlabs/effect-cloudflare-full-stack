/**
 * Every page behind sign-in hangs off this layout route.
 *
 * A LAYOUT route rather than a check inside each page, because then membership of the authenticated set
 * is structural: a new file under `_authenticated/` is guarded by where it sits, and there is no
 * per-page line anyone can forget. The `_` prefix means the segment does not appear in the URL — this is
 * a guard, not a path.
 *
 * `beforeLoad` runs on the SERVER during SSR, so an unauthenticated visitor is redirected before any HTML
 * is produced. That is the property the move to Start bought; on the SPA the best available was a
 * render-then-correct flicker.
 */
import { authClient } from "@/auth/auth-client"
import { Button } from "@/components/ui/button"
import { useHydrated } from "@/hooks/use-hydrated"
import { useIdentity, useOrganizationId } from "@/hooks/use-session"
import { RealtimeBridge } from "@/realtime/realtime-bridge"
import { WebSocketProvider } from "@/realtime/socket-provider"
import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: ({ context, location }) => {
    if (context.session._tag === "Guest") {
      /*
       * `redirect` THROWS. That is the point: it stops the load rather than returning a value some
       * caller has to remember to act on, so there is no path where the guard ran and the page
       * rendered anyway.
       *
       * `redirect` carries where they were going, so signing in resumes the journey instead of dumping
       * everyone on the queue — the difference between a login wall and a login interruption.
       */
      throw redirect({ to: "/login", search: { next: location.href } })
    }
  },
  component: AuthenticatedLayout
})

/**
 * The shell every signed-in page sits inside: who you are, and how to stop being them.
 *
 * `useIdentity()` rather than `useSession()` — this renders only below the guard above, so the Guest case
 * is structurally impossible and narrowing a union here would be pretending otherwise.
 */
function AuthenticatedLayout() {
  const identity = useIdentity()
  const organizationId = useOrganizationId()
  const navigate = useNavigate()
  const hydrated = useHydrated()

  return (
    /*
     * ONE socket for the whole authenticated app, opened here.
     *
     * Here rather than at the root because this is the first point at which there is a session to
     * authenticate the upgrade with, and rather than per screen because a hook that opened its own socket
     * would give a queue and a notification bell two connections to the same room — two keepalives, two
     * reconnects, and twice the request budget.
     *
     * `enabled` is false when there is no active organization: there is no room to join, and the socket would
     * be refused. Passing the flag rather than omitting the provider keeps `useSocket` from throwing inside
     * an unrelated component for what is a legitimate state.
     */
    <WebSocketProvider enabled={organizationId !== null}>
      {/* Frames become atoms here, and only here — see realtime-bridge.tsx. Renders nothing. */}
      {organizationId === null ? null : <RealtimeBridge />}
      <div className="flex min-h-full flex-col">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-medium">effect-ai</span>
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground text-sm">{identity.email}</span>
            <Button
              variant="outline"
              size="sm"
              /*
               * Disabled until hydrated, because everything this button does is JavaScript: before that a
               * click is a silent no-op, and the person has been told they signed out when they did not.
               * That is a worse failure than a control that is visibly not ready yet — on a shared machine
               * it is the whole point of the button. The e2e suite found it by clicking faster than the
               * bundle loads, which is also how a real person on a cold connection would.
               */
              disabled={!hydrated}
              onClick={async () => {
                await authClient.signOut()
                /*
                 * `reloadDocument` for the same reason sign-in needs it, in reverse: the session was cleared
                 * on this response and the router context still holds the Authenticated value resolved
                 * before it. A soft navigation would carry the stale context and render the signed-in shell
                 * for somebody who is no longer signed in.
                 */
                await navigate({ to: "/login", search: { next: "/" }, reloadDocument: true })
              }}
            >
              Sign out
            </Button>
          </div>
        </header>
        <div className="flex-1">
          {
            /*
             * A session with no active organization is a real state, and every page below here would fail on
             * it: the API's `resolveIdentity` refuses such a session, so the queue would render an error and
             * the upload form would 403. Saying so once, here, is both more honest and cheaper than each page
             * discovering it separately — and it is the guard's job, since "which tenant" is as much a
             * precondition for these pages as "who".
             *
             * Not a redirect, because there is nowhere useful to send them: they ARE signed in, and the fix is
             * an invitation or an organization switcher, neither of which exists yet. A named dead end beats a
             * loop between here and a login page that would send them straight back.
             */
          }
          {organizationId === null
            ? (
              <div className="text-muted-foreground mx-auto max-w-md px-4 py-16 text-sm">
                This account has no active organization, so there is nothing to review yet. Ask an administrator for an
                invitation.
              </div>
            )
            : <Outlet />}
        </div>
      </div>
    </WebSocketProvider>
  )
}
