/**
 * The planning page's SSR data: its query atoms, run on the server and dehydrated (`atoms/dehydrate.ts`).
 *
 * In a module of its own, importing NOTHING from the atom or RPC graph at the top level: the atoms are imported
 * inside the handler. TanStack Start's compiler analyses every identifier a server function's module references,
 * and when that reached `rpc.ts` on a cold dev server it failed ("could not load module info"), the client entry did
 * not load, and the page never hydrated. A handler body is server-only, so the dynamic import costs the client
 * nothing and leaves the compiler nothing to chase.
 */
import { dehydrateAtoms } from "@/atoms/dehydrate"
import { createServerFn } from "@tanstack/react-start"

export const loadPlanningPage = createServerFn({ method: "GET" }).handler(async () => {
  const { planningAtom, jobsAtom, invoicesAtom } = await import("./planning-atoms.ts")
  return dehydrateAtoms([planningAtom, jobsAtom, invoicesAtom])
})
