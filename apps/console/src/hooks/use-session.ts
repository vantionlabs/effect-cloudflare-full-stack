/**
 * The signed-in user, from router context rather than a fetch.
 *
 * The session is resolved ONCE per request in the root route's `beforeLoad` and handed down through router
 * context, so a component reading it does no work at all — no request, no loading state, no suspense
 * boundary. That is the payoff for doing auth on the server: `useSession()` is a synchronous read.
 *
 * Two hooks rather than one, because the two callers want different things:
 *
 * `useSession()` returns the union, for a component that renders differently for a guest — a nav bar with
 * either a name or a sign-in link.
 *
 * `useIdentity()` returns the user and THROWS for a guest. Only legal under `_authenticated`, where the
 * layout guard has already redirected, so the throw is unreachable rather than a risk. It exists so a
 * screen behind the guard is not forced to narrow a union it already knows the answer to — the alternative
 * is `session._tag === "Guest" ? null : ...` in every authenticated component, which is noise that also
 * invites rendering something for a case that cannot happen.
 */
import type { CurrentSession } from "@/auth/current-session"
import { useRouteContext } from "@tanstack/react-router"

/*
 * Not exported yet: `useIdentity` is its only caller, and knip flags an export with no importer. Export it
 * the moment something renders differently for a guest — a marketing header, or a nav with either a name or
 * a sign-in link. The two-hook split is still the right shape; only its visibility is provisional.
 */
const useSession = (): CurrentSession => useRouteContext({ from: "__root__", select: (context) => context.session })

export const useIdentity = () => {
  const session = useSession()
  if (session._tag === "Guest") {
    /*
     * Unreachable under `_authenticated`, and a loud failure rather than a silent fallback if the guard is
     * ever bypassed. Returning `undefined` here would let a component render a blank name for a signed-out
     * user, which is the failure that looks like a styling bug for a week.
     */
    throw new Error("useIdentity() was called outside an authenticated route")
  }
  return session.user
}

/**
 * The active organization, which is the TENANT and therefore not part of `useIdentity`.
 *
 * Kept separate on purpose. `useIdentity` answers "who is this", and a user is one thing; "which
 * organization's data am I looking at" is another, and better-auth models it on the session rather than the
 * user precisely because one user can switch between several. Folding it into the identity would make an
 * organization switcher look like it changes who you are.
 *
 * Returns `null` when a session exists with no active organization — a real state rather than an error. The
 * API's own `resolveIdentity` refuses such a session, so a caller that needs a tenant must handle the null
 * rather than assert it away; what it must NOT do is substitute a default, which is how one tenant ends up
 * reading another's queue.
 */
export const useOrganizationId = (): string | null => {
  const session = useSession()
  if (session._tag === "Guest") {
    throw new Error("useOrganizationId() was called outside an authenticated route")
  }
  return session.organizationId ?? null
}
