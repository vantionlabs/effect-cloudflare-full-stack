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
import { AppShell } from "@/components/layout/app-shell"
import { SignOutButton } from "@/features/auth/components/sign-out-button"
import { useSession } from "@/hooks/use-session"
import { RealtimeBridge } from "@/realtime/realtime-bridge"
import { WebSocketProvider } from "@/realtime/socket-provider"
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"
import { useCommandRecords } from "./-command-records.tsx"

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

function AuthenticatedLayout() {
  const session = useSession()
  /*
   * Guest HERE is a transition, not a state: `router.invalidate()` re-resolved the session (a sign-out elsewhere, a
   * revoked session) and the guard above is about to redirect. The session atom updates a render earlier than the
   * navigation lands, and the shell's hooks throw for a Guest by design — so for that one render, render nothing
   * rather than let the error boundary flash.
   */
  if (session._tag === "Guest") return null
  const organizationId = session.organizationId ?? null
  return (
    /*
     * ONE socket for the whole authenticated app, opened here.
     *
     * Here rather than at the root because this is the first point at which there is a session to authenticate the
     * upgrade with, and rather than per screen because a hook that opened its own socket would give a queue and a
     * notification bell two connections to the same room — two keepalives, two reconnects, and twice the request
     * budget.
     *
     * `enabled` is false when there is no active organization: there is no room to join, and the socket would be
     * refused. Passing the flag rather than omitting the provider keeps `useSocket` from throwing inside an unrelated
     * component for what is a legitimate state.
     */
    <WebSocketProvider enabled={organizationId !== null}>
      {/* Frames become atoms here, and only here — see realtime-bridge.tsx. Renders nothing. */}
      {organizationId === null ? null : <RealtimeBridge />}
      <AppShell signOut={<SignOutButton />} useCommandRecords={useCommandRecords}>
        <Outlet />
      </AppShell>
    </WebSocketProvider>
  )
}
