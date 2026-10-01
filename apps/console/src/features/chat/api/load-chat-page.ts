/**
 * The chat page's SSR data: the channel list, dehydrated so it arrives with the page. The open channel's messages
 * load in the browser behind a skeleton — they depend on which channel is open and change by the second.
 * Atoms are imported inside the handler; see `load-planning-page.ts`.
 */
import { dehydrateAtoms } from "@/rpc/dehydrate"
import { createServerFn } from "@tanstack/react-start"

export const loadChatPage = createServerFn({ method: "GET" }).handler(async () => {
  const { roomsAtom } = await import("./room-atoms.ts")
  return dehydrateAtoms([roomsAtom])
})
