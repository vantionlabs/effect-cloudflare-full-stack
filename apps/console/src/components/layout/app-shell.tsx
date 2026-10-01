/**
 * The shell every signed-in page sits inside: navigation on the left with the account at its foot, and the page.
 */
import { useIdentity, useOrganizationId } from "@/hooks/use-session"
import { cn } from "@/lib/utils"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { AppSidebar } from "./app-sidebar.tsx"

/** `signOut` is passed in rather than imported: the shell is shared, and the control belongs to the auth feature. */
export function AppShell(props: { readonly signOut: ReactNode; readonly children: ReactNode }) {
  const identity = useIdentity()
  const organizationId = useOrganizationId()
  const initial = (identity.name ?? identity.email).charAt(0).toUpperCase()
  return (
    <div className="flex min-h-dvh flex-col bg-page md:flex-row">
      <AppSidebar
        footer={(collapsed) => (
          /*
           * Rendered ONCE at every width: an earlier version also had a mobile-only copy hidden by CSS, which a screen
           * reader announced twice and which made the email ambiguous to every test that reads it.
           */
          <div className="flex items-center justify-between gap-2 md:flex-col md:items-stretch">
            <Link
              to="/account"
              className="flex min-w-0 items-center gap-2 rounded-control px-1.5 py-1 transition-colors duration-100 hover:bg-hover"
              title="Mijn account"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-tint text-[11px] font-semibold text-accent-ink">
                {initial}
              </span>
              <span
                className={cn(
                  "min-w-0 truncate text-[12px] text-ink-2 transition-opacity duration-150",
                  collapsed && "md:opacity-0"
                )}
              >
                {identity.email}
              </span>
            </Link>
            <div className={cn("transition-opacity duration-150", collapsed && "md:hidden")}>{props.signOut}</div>
          </div>
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {
          /*
           * A session with no active organization is a real state, and every page below here would fail on it: the
           * API's `resolveIdentity` refuses such a session, so the queue would render an error and the upload form
           * would 403. Saying so once, here, is both more honest and cheaper than each page discovering it separately.
           *
           * Not a redirect, because there is nowhere useful to send them: they ARE signed in, and the fix is an
           * invitation or an organization switcher, neither of which exists yet. A named dead end beats a loop between
           * here and a login page that would send them straight back.
           */
        }
        {organizationId === null
          ? (
            <div className="mx-auto max-w-md px-4 py-16 text-sm text-ink-2">
              Dit account hoort nog bij geen organisatie, dus er is nog niets te zien. Vraag een beheerder om een
              uitnodiging.
            </div>
          )
          : props.children}
      </div>
    </div>
  )
}
