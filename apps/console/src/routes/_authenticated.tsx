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
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"

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
  component: () => <Outlet />
})
