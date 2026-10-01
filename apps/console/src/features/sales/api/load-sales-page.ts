/**
 * The sales page's SSR data: its query atoms, run on the server and dehydrated (`rpc/dehydrate.ts`).
 *
 * In a module of its own, importing NOTHING from the atom or RPC graph at the top level: the atoms are imported
 * inside the handler. TanStack Start's compiler analyses every identifier a server function's module references,
 * and when that reached `rpc/client.ts` on a cold dev server it failed ("could not load module info"), the client entry did
 * not load, and the page never hydrated. A handler body is server-only, so the dynamic import costs the client
 * nothing and leaves the compiler nothing to chase.
 */
import { dehydrateAtoms } from "@/rpc/dehydrate"
import { createServerFn } from "@tanstack/react-start"

export const loadSalesPage = createServerFn({ method: "GET" }).handler(async () => {
  const { productsAtom, quotesAtom, changesAtom, customerTermsAtom, inboundMessagesAtom } = await import(
    "./sales-atoms.ts"
  )
  return dehydrateAtoms([productsAtom, quotesAtom, changesAtom, customerTermsAtom, inboundMessagesAtom])
})
