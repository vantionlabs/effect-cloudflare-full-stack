/**
 * Channels: a list on the left, the selected channel's messages on the right.
 *
 * The Discord shape, minus everything that is not needed to prove it works. What it deliberately does not have:
 * unread badges (they need read receipts), member lists (a channel is visible to the whole organization today),
 * and any notion of a private channel. Each of those is its own issue with its own reason to exist — the risk
 * the plan calls R8, chat attracting scope.
 *
 * The selected channel lives in URL state rather than component state, so a channel is a link somebody can send
 * a colleague. That is also why the route validates it: an unknown room id must not render a broken pane.
 */
import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import { useCallback, useState } from "react"
import { archiveRoomAtom, createRoomAtom, roomsAtom } from "./thread-atoms.ts"
import { Thread } from "./thread.tsx"

export function ChatScreen({
  onSelect,
  selected
}: {
  readonly selected: string | undefined
  readonly onSelect: (roomId: string | undefined) => void
}) {
  const rooms = useAtomValue(roomsAtom)
  const refreshRooms = useAtomRefresh(roomsAtom)
  const create = useAtomSet(createRoomAtom, { mode: "promise" })
  const archive = useAtomSet(archiveRoomAtom, { mode: "promise" })
  const [name, setName] = useState("")
  const [rejected, setRejected] = useState<string | undefined>(undefined)

  const channels = rooms._tag === "Success" ? rooms.value : []
  const current = channels.find((room) => room.id === selected) ?? channels[0]

  const submit = useCallback(async () => {
    const trimmed = name.trim()
    if (trimmed === "") return
    setRejected(undefined)
    try {
      const room = await create({ payload: { name: trimmed } })
      setName("")
      /*
       * The list is refreshed locally as well as by the broadcast. The frame will arrive and invalidate too, but
       * waiting for a round trip through the room to see your own channel appear would make creating one feel
       * slower than it is — and the two paths converge on the same query, so a double refresh costs one fetch.
       */
      refreshRooms()
      onSelect(room.id)
    } catch (error) {
      /*
       * `_tag`, not `.message`: a `Schema.TaggedError` is an `Error` whose message is usually empty (AGENTS.md).
       * Both refusals are actionable and read differently — "that channel exists" versus "pick a real name".
       */
      const tag = (error as { readonly _tag?: string })._tag
      setRejected(
        tag === "RoomSlugTaken"
          ? "A channel with that name already exists."
          : tag === "RoomNameInvalid"
          ? "A channel name needs letters or numbers."
          : "Could not create the channel."
      )
    }
  }, [create, name, onSelect, refreshRooms])

  return (
    <main style={{ display: "grid", gridTemplateColumns: "16rem 1fr", height: "100%" }}>
      <nav style={{ borderRight: "1px solid #ddd", overflowY: "auto", padding: "1rem" }}>
        <h1 style={{ font: "600 0.8rem ui-sans-serif", color: "#666", margin: "0 0 0.75rem" }}>
          CHANNELS · {channels.length}
        </h1>

        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.15rem" }}>
          {channels.map((room) => (
            <li key={room.id} style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
              <button
                type="button"
                onClick={() => onSelect(room.id)}
                aria-current={room.id === current?.id ? "true" : undefined}
                style={{
                  flex: 1,
                  textAlign: "left",
                  font: "inherit",
                  padding: "0.3rem 0.4rem",
                  border: 0,
                  background: room.id === current?.id ? "#eee" : "transparent",
                  cursor: "pointer"
                }}
              >
                # {room.slug}
                {
                  /*
                   * The badge counts what SOMEBODY ELSE said and you have not read — never your own messages, or
                   * posting would feel like falling behind. Absent at zero rather than showing "0", which is
                   * noise on every row of a quiet list.
                   */
                }
                {room.unreadCount === 0 ? null : (
                  <span
                    aria-label={`${room.unreadCount} unread`}
                    style={{
                      marginLeft: "0.4rem",
                      fontSize: "0.72rem",
                      background: "#b00",
                      color: "#fff",
                      borderRadius: "999px",
                      padding: "0.05rem 0.35rem"
                    }}
                  >
                    {room.unreadCount}
                  </span>
                )}
              </button>
              <button
                type="button"
                title="Archive this channel"
                /*
                 * Archive, never delete. The conversation in a channel is the argument about decisions made in
                 * it, and a product claiming a year-old decision is auditable should not offer to destroy that
                 * with one click. Archiving is reversible and keeps every message readable.
                 */
                onClick={async () => {
                  await archive({ payload: { roomId: room.id as never, archived: true } })
                  refreshRooms()
                  if (room.id === selected) onSelect(undefined)
                }}
                style={{ font: "inherit", border: 0, background: "transparent", cursor: "pointer", color: "#999" }}
              >
                ×
              </button>
            </li>
          ))}
        </ol>

        <form
          method="post"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
          style={{ marginTop: "1rem", display: "grid", gap: "0.4rem" }}
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="New channel"
            aria-label="New channel name"
            style={{ font: "inherit", padding: "0.3rem 0.4rem" }}
          />
          <button type="submit" disabled={name.trim() === ""} style={{ font: "inherit" }}>Create</button>
        </form>

        {rejected === undefined
          ? null
          : <p role="alert" style={{ color: "#b00", fontSize: "0.8rem" }}>{rejected}</p>}
      </nav>

      <section style={{ padding: "1.5rem", overflowY: "auto" }}>
        {current === undefined
          ? (
            <p style={{ color: "#888" }}>
              No channels yet. Create one on the left — it is visible to everybody in your organization.
            </p>
          )
          : (
            <>
              <h2 style={{ margin: 0 }}># {current.slug}</h2>
              {current.topic === null
                ? null
                : <p style={{ color: "#666", marginTop: "0.25rem" }}>{current.topic}</p>}
              <Thread kind="room" id={current.id} title="MESSAGES" />
            </>
          )}
      </section>
    </main>
  )
}
