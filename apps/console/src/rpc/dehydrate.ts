/**
 * Runs atoms on the server and returns their state for `HydrationBoundary` — Effect Atom's SSR model.
 *
 * A page's server function calls this with the query atoms the page reads. Each is run to completion in a FRESH
 * registry (one per request: a shared one would hand one visitor's data to the next), then `Hydration.dehydrate`
 * encodes every serializable atom in it. The page wraps its content in `<HydrationBoundary state={…}>`, so the
 * browser's registry starts with those values and `useAtomValue` renders them on the first pass — on the server
 * and again on hydration — with no fetch after load. The atoms stay live afterwards: a mutation's reactivity keys
 * refresh them exactly as before.
 *
 * Only atoms made serializable are dehydrated, which for an `Api.query` means passing a `serializationKey`. One
 * without it is fetched here and then silently dropped, so the page would fetch it again in the browser — the
 * failure this exists to prevent, and the reason every key is named where the atom is defined.
 *
 * A failed query is dehydrated as its failure rather than thrown, so the page renders its own error state instead
 * of the route's error boundary.
 *
 * **Every atom is MOUNTED until it has been dehydrated.** `getResult` unsubscribes the moment the value arrives, so an
 * atom nothing else held could be removed from the registry before `Hydration.dehydrate` read it — and was silently
 * left out. Found on the Ask page: the documents survived, the conversation list and history did not, so the page
 * rendered skeletons and fetched them again after load. Which atoms survived depended on timing, which is why other
 * pages' SSR checks still passed.
 */
import { Effect } from "effect"
import { type AsyncResult, type Atom, AtomRegistry, Hydration } from "effect/reactivity"

export const dehydrateAtoms = async (
  atoms: ReadonlyArray<Atom.Atom<AsyncResult.AsyncResult<unknown, unknown>>>
): Promise<Array<Hydration.DehydratedAtom>> => {
  const registry = AtomRegistry.make()
  const unmount = atoms.map((atom) => registry.mount(atom))
  try {
    await Promise.all(atoms.map((atom) => Effect.runPromiseExit(AtomRegistry.getResult(registry, atom))))
    return Hydration.dehydrate(registry)
  } finally {
    for (const release of unmount) release()
    registry.dispose()
  }
}
