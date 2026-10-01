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
import type { CurrentSession } from "@/features/auth/api/current-session"
import { sessionAtom } from "@/features/auth/api/session-atoms"
import { useAtomInitialValues, useAtomSet, useAtomValue } from "@effect/atom-react"
import { useRouteContext } from "@tanstack/react-router"
import { useEffect } from "react"

/**
 * Seeds `sessionAtom` from router context. Called once, from the root route's component.
 *
 * `useAtomInitialValues` writes into the current registry and does so **at most once per atom per registry**,
 * which is exactly the hydration semantics wanted: the server's answer is there before the first child
 * renders, and a later render cannot clobber a value the app has since changed. One registry per router means
 * one per request on the server, so nothing leaks between two visitors.
 *
 * The effect afterwards is not redundant. Seeding happens once, but router context can be resolved again —
 * `router.invalidate()` re-runs `beforeLoad` — and without this the atom would then disagree with the context
 * the guards use. Sign-in and sign-out do not rely on it, because both reload the document and therefore
 * build a new registry.
 *
 * It must render ABOVE anything calling `useSession`, which is why it lives in the root component rather than
 * being a hook each screen remembers to call. A consumer above it reads the Guest default and fails closed.
 */
export const useHydrateSession = (): void => {
  const session = useRouteContext({ from: "__root__", select: (context) => context.session })
  useAtomInitialValues([[sessionAtom, session]])
  const setSession = useAtomSet(sessionAtom)
  useEffect(() => setSession(session), [session, setSession])
}

/*
 * Reads the ATOM, not router context, and the two are kept in step by `useHydrateSession` above. Components
 * could read either; going through the atom means there is one answer in the app rather than one for
 * components and another for atoms, and it is the atom that other atoms can depend on.
 *
 * Not exported yet: `useIdentity` is its only caller, and knip flags an export with no importer. Export it
 * the moment something renders differently for a guest — a marketing header, or a nav with either a name or
 * a sign-in link.
 */
const useSession = (): CurrentSession => useAtomValue(sessionAtom)

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
