/** The channel list, and the mutations that change it. Threads themselves are `components/thread`, shared with the queue. */
import { Api } from "@/rpc/client"

export const ROOMS_KEY = "rooms"
export const roomsAtom = Api.query("Room.list", {}, {
  // Rendered on the server and hydrated (`load-chat-page.ts`), so the channel list arrives with the page.
  serializationKey: "rooms",
  reactivityKeys: [ROOMS_KEY]
})
export const createRoomAtom = Api.mutation("Room.create")
export const archiveRoomAtom = Api.mutation("Room.archive")
