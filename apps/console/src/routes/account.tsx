/**
 * My account — deliberately OUTSIDE the dashboard layout (`_authenticated`): it is about the person, not the
 * organization, so it has its own frame and no workspace navigation. It still needs a session, so it carries the same
 * guard as the dashboard.
 */
import { AccountPage } from "@/features/account/account-page"
import { SignOutButton } from "@/features/auth/components/sign-out-button"
import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/account")({
  beforeLoad: ({ context, location }) => {
    if (context.session._tag === "Guest") throw redirect({ to: "/login", search: { next: location.href } })
  },
  component: AccountRoute
})

function AccountRoute() {
  return <AccountPage signOut={<SignOutButton />} />
}
