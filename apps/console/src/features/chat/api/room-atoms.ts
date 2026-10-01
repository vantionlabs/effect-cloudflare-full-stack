/** The channel list, and the mutations that change it. Threads themselves are `components/thread`, shared with the queue. */
import { Api } from "@/rpc/client"

export const ROOMS_KEY = "rooms"
export const roomsAtom = Api.query("Room.list", {}, { reactivityKeys: [ROOMS_KEY] })
export const createRoomAtom = Api.mutation("Room.create")
export const archiveRoomAtom = Api.mutation("Room.archive")
