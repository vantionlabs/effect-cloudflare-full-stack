/**
 * The session, in an atom, seeded from the server's answer.
 *
 * **Why this exists when router context already holds it.** `beforeLoad` resolves the session once per
 * request and hands it down as router context, which is the right thing and stays the source: it is what the
 * guards in `_authenticated` and `_guest` compare, before any HTML is sent. But router context is only
 * reachable from a component inside the router. An **atom** is reachable from other atoms — so a query can be
 * derived from the session rather than having the session passed into it, which is the thing that was
 * otherwise impossible:
 *
 * ```ts
 * const myOrgThing = Atom.make((get) => {
 *   const session = get(sessionAtom)
 *   return session._tag === "Authenticated" ? … : …
 * })
 * ```
 *
 * **Seeded, never fetched.** This is the TanStack-Query `prefetch` + `hydrate` shape: the value comes from the
 * server-rendered pass through `useAtomInitialValues`, so the client starts with the answer and makes no
 * request for it on load. A `useEffect` that fetched the session on mount — the obvious alternative — would
 * mean every page load asks a question the server already answered, and would flicker through Guest first.
 */
import type { CurrentSession } from "@/features/auth/api/current-session"
import { Atom } from "effect/reactivity"

/**
 * Defaults to Guest, and that default is load-bearing.
 *
 * It is what an unseeded read returns — a component rendered above the hydrator, or a test that never seeded
 * anything. Failing closed means such a bug shows up as "not signed in", which is safe and obvious, rather
 * than as a half-populated identity. `useIdentity` then throws rather than rendering a blank name.
 */
const guest: CurrentSession = { _tag: "Guest" }

/*
 * The type argument is explicit, and it has to be. TypeScript narrows a `const` to its initializer even when
 * the declaration is annotated with a union, so `Atom.make(guest)` infers `Writable<{ _tag: "Guest" }>` — and
 * `Writable` is invariant, so writing an Authenticated session then fails at the one place that must work.
 */
export const sessionAtom = Atom.make<CurrentSession>(guest)
