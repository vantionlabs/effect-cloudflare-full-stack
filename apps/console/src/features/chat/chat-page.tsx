/**
 * Channels: a list on the left, the selected channel's messages on the right.
 *
 * The Discord shape, minus everything that is not needed to prove it works. What it deliberately does not have:
 * member lists (a channel is visible to the whole organization today) and any notion of a private channel. Each of
 * those is its own issue with its own reason to exist — the risk the plan calls R8, chat attracting scope.
 *
 * The selected channel lives in URL state rather than component state, so a channel is a link somebody can send
 * a colleague. That is also why the route validates it: an unknown room id must not render a broken pane.
 */
import { Notice } from "@/components/feedback/notice"
import { Thread } from "@/components/thread/thread"
import { useAtomValue } from "@effect/atom-react"
import { roomsAtom } from "./api/room-atoms.ts"
import { ChannelList } from "./components/channel-list.tsx"
import { NewChannelForm } from "./components/new-channel-form.tsx"

export function ChatPage({
  onSelect,
  selected
}: {
  readonly selected: string | undefined
  readonly onSelect: (roomId: string | undefined) => void
}) {
  const rooms = useAtomValue(roomsAtom)
  const channels = rooms._tag === "Success" ? rooms.value : []
  const current = channels.find((room) => room.id === selected) ?? channels[0]

  return (
    <main className="grid min-h-0 flex-1 grid-rows-[auto_1fr] md:h-dvh md:grid-cols-[16rem_1fr] md:grid-rows-1">
      <nav aria-label="Channels" className="flex min-h-0 flex-col gap-4 border-line bg-surface p-4 md:border-r">
        <h1 className="flex items-baseline gap-2 text-[15px] font-semibold text-ink">
          Channels <span className="text-[12px] font-normal text-ink-2">{channels.length}</span>
        </h1>
        {rooms._tag === "Failure" ? <Notice tone="error">The channels could not be loaded.</Notice> : null}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ChannelList channels={channels} currentId={current?.id} onSelect={onSelect} />
        </div>
        <NewChannelForm onCreated={onSelect} />
      </nav>

      <section className="flex min-h-0 flex-col gap-4 overflow-y-auto p-6 md:p-8">
        {current === undefined
          ? (
            <p className="text-[13px] text-ink-2">
              No channels yet. Create one on the left — it is visible to everybody in your organization.
            </p>
          )
          : (
            <>
              <header className="flex flex-col gap-1">
                {/* The ONE level-2 heading on the page: the e2e suite reads the open channel's name from it. */}
                <h2 className="text-lg font-semibold text-ink"># {current.slug}</h2>
                {current.topic === null ? null : <p className="text-[13px] text-ink-2">{current.topic}</p>}
              </header>
              <Thread kind="room" id={current.id} title="MESSAGES" />
            </>
          )}
      </section>
    </main>
  )
}
