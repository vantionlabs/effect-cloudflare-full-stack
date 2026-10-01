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
import { enter } from "@/lib/motion"
import { useAtomValue } from "@effect/atom-react"
import { MessagesSquare } from "lucide-react"
import { roomsAtom } from "./api/room-atoms.ts"
import { ChannelList, ChannelListSkeleton } from "./components/channel-list.tsx"
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
      <nav aria-label="Kanalen" className="flex min-h-0 flex-col gap-4 border-line bg-surface p-4 md:border-r">
        <h1 className="flex items-baseline gap-2 text-[15px] font-semibold text-ink">
          Kanalen <span className="text-[12px] font-normal text-ink-2">{channels.length}</span>
        </h1>
        {rooms._tag === "Failure" ? <Notice tone="error">De kanalen konden niet worden geladen.</Notice> : null}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {
            /*
             * The server renders the list (`load-chat-page.ts`); `Initial` is only seen when the browser fetches it
             * itself, and then the list's shape stands in rather than "no channels yet", which would be a false claim.
             */
          }
          {rooms._tag === "Initial"
            ? <ChannelListSkeleton />
            : <ChannelList channels={channels} currentId={current?.id} onSelect={onSelect} />}
        </div>
        <NewChannelForm onCreated={onSelect} />
      </nav>

      <section className="flex min-h-0 flex-col gap-4 p-6 md:p-8">
        {rooms._tag === "Initial"
          ? null
          : current === undefined
          ? (
            <div className="flex flex-col items-start gap-2" style={enter(0)}>
              <span className="flex size-9 items-center justify-center rounded-card bg-accent-tint text-accent-ink">
                <MessagesSquare className="size-5" aria-hidden />
              </span>
              <h2 className="text-[15px] font-semibold text-ink">Nog geen kanalen</h2>
              <p className="max-w-sm text-[13px] text-ink-2">
                Maak links een kanaal aan om met je collega's te overleggen. Iedereen in je organisatie kan het zien.
              </p>
            </div>
          )
          : (
            <>
              <header className="flex flex-col gap-1">
                {/* The ONE level-2 heading on the page: the e2e suite reads the open channel's name from it. */}
                <h2 className="text-lg font-semibold text-ink"># {current.slug}</h2>
                {current.topic === null ? null : <p className="text-[13px] text-ink-2">{current.topic}</p>}
              </header>
              {/* Keyed by channel, so switching channels starts a fresh thread rather than "arriving" every message. */}
              <Thread key={current.id} kind="room" id={current.id} title="Berichten" layout="fill" />
            </>
          )}
      </section>
    </main>
  )
}
