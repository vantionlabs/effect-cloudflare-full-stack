/**
 * Moves to a page after the session changed on the server — signed in, signed up, or every session revoked by a
 * password reset — WITHOUT reloading the document.
 *
 * The router context holds the session resolved before the change, and the guards read that context, so a plain
 * client navigation would run them against the stale value (a fresh sign-in bounced straight back to /login). This
 * used to be solved with `reloadDocument`, which works and feels like a website rather than an app.
 * `router.invalidate()` re-runs the root's `beforeLoad`, which asks the server for the session again; the guards then
 * see the new one, and `useHydrateSession` carries it into the session atom.
 *
 * Only for changes that move AWAY from a guest, or that leave no tenant data behind. Signing out and switching
 * organization still reload the document: the atom registry holds the previous tenant's data, and a soft navigation
 * would keep it in memory for whoever uses the tab next.
 */
import { useNavigate, useRouter } from "@tanstack/react-router"

export const useSessionChange = () => {
  const router = useRouter()
  const navigate = useNavigate()
  // Typed as `navigate` itself, so the route-aware checking of `to`, `params` and `search` is kept.
  const go: typeof navigate = async (options) => {
    await router.invalidate()
    return navigate(options)
  }
  return go
}
