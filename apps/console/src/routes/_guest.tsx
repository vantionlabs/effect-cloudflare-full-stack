/**
 * The mirror: pages that only make sense when NOT signed in.
 *
 * Without this, a signed-in user following a stale `/login` link gets a login form, signs in again, and
 * is issued a second session — which looks like it worked and quietly muddies the audit trail. Sending
 * them to the queue instead is both kinder and more honest.
 */
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_guest")({
  beforeLoad: ({ context }) => {
    if (context.session._tag === "Authenticated") throw redirect({ to: "/" })
  },
  component: () => <Outlet />
})
