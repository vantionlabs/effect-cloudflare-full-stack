/**
 * The queue's SSR data: the pending decisions, run on the server and dehydrated, so the list arrives with the page
 * rather than appearing after it. Atoms are imported inside the handler — see `load-planning-page.ts` for why a
 * static import of the atom graph from a server-function module breaks the cold dev server.
 *
 * Only the LIST. The decision under inspection depends on the cursor, which the server does not know, so it loads in
 * the browser behind a skeleton.
 */
import { dehydrateAtoms } from "@/rpc/dehydrate"
import { createServerFn } from "@tanstack/react-start"

export const loadQueuePage = createServerFn({ method: "GET" }).handler(async () => {
  const { queueAtom } = await import("./queue-atoms.ts")
  return dehydrateAtoms([queueAtom])
})
