/**
 * The settings page's RPC data, dehydrated for SSR — the address section arrives filled in, like the rest of the
 * page. Its own module with the atoms imported inside the handler, as every loader is (AGENTS.md: a static import of
 * the atom graph from a server-function module fails the cold dev server).
 */
import { createServerFn } from "@tanstack/react-start"

export const loadSettingsAtoms = createServerFn({ method: "GET" }).handler(async () => {
  const { inboundAddressAtom } = await import("./inbound-atoms.ts")
  const { dehydrateAtoms } = await import("@/rpc/dehydrate")
  return dehydrateAtoms([inboundAddressAtom])
})
