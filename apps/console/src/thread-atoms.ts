/**
 * A room's thread: the query, the mutation, and the key that ties them to the socket.
 *
 * Same shape as `queue-atoms.ts`, including the part that matters — a family keyed by the subject, built at
 * module scope. `Api.query(...)` called inside a component builds a new atom on every render, which means no
 * cache, a refetch per keystroke elsewhere on the page, and the atom's own loading state thrown away each time.
 * That bug was in this file's neighbour twice before it was noticed.
 */
import { Atom } from "effect/reactivity"
import { Api } from "./rpc.ts"

/**
 * One key per DECISION, not per room id, and that is deliberate.
 *
 * A decision's thread may not have a room yet — it is created by the first message — so the client has no room
 * id to key on until somebody posts. Keying on the decision means the key is stable from the first render, and
 * the socket frame carries the room id, which `realtime-bridge` maps back through the rooms it knows about.
 */
export const decisionThreadKey = (decisionId: string) => `thread:decision:${decisionId}`

/** And one per room, for channels, which always have an id before anybody reads them. */
export const roomThreadKey = (roomId: string) => `thread:room:${roomId}`

export const decisionThreadAtom = Atom.family((decisionId: string) =>
  Api.query(
    "Message.list",
    { room: { _tag: "RoomForDecision" as const, decisionId }, limit: 200 },
    { reactivityKeys: [decisionThreadKey(decisionId)] }
  )
)

export const roomThreadAtom = Atom.family((roomId: string) =>
  Api.query(
    "Message.list",
    { room: { _tag: "RoomById" as const, roomId: roomId as never }, limit: 200 },
    { reactivityKeys: [roomThreadKey(roomId)] }
  )
)

export const postMessageAtom = Api.mutation("Message.post")
export const editMessageAtom = Api.mutation("Message.edit")
export const deleteMessageAtom = Api.mutation("Message.delete")
export const reactAtom = Api.mutation("Message.react")

/**
 * The quick picks offered next to a message.
 *
 * A short list rather than a picker, because a picker is a component and these four cover what a review thread
 * actually needs: agreement, disagreement, attention, and "looked at it". The server accepts any short string, so
 * a real picker is a UI change and not a contract change.
 */
export const QUICK_REACTIONS = ["👍", "👀", "🎉", "❓"] as const

/** The channel list, and the mutations that change it. */
export const ROOMS_KEY = "rooms"
export const roomsAtom = Api.query("Room.list", {}, { reactivityKeys: [ROOMS_KEY] })
export const createRoomAtom = Api.mutation("Room.create")
export const archiveRoomAtom = Api.mutation("Room.archive")
