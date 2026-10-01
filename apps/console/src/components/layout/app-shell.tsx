/**
 * The shell every signed-in page sits inside: navigation on the left, who you are and how to stop being them at its
 * foot, and the page.
 */
import { useIdentity, useOrganizationId } from "@/hooks/use-session"
import type { ReactNode } from "react"
import { AppSidebar } from "./app-sidebar.tsx"

/** `signOut` is passed in rather than imported: the shell is shared, and the control belongs to the auth feature. */
export function AppShell(props: { readonly signOut: ReactNode; readonly children: ReactNode }) {
  const identity = useIdentity()
  const organizationId = useOrganizationId()
  return (
    <div className="flex min-h-dvh flex-col bg-page md:flex-row">
      <AppSidebar
        footer={
          /*
           * Rendered ONCE at every width: an earlier version also had a mobile-only copy hidden by CSS, which a screen
           * reader announced twice and which made the email ambiguous to every test that reads it.
           */


            <div className="flex items-center justify-between gap-2 px-2 md:flex-col md:items-start">
              <span className="min-w-0 max-w-full truncate text-[12px] text-ink-2" title={identity.email}>
                {identity.email}
              </span>
              {props.signOut}
            </div>

        }
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
              This account has no active organization, so there is nothing to review yet. Ask an administrator for an
              invitation.
            </div>
          )
          : props.children}
      </div>
    </div>
  )
}
