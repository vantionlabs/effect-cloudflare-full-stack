/** The organization's channels, each with its unread count and a way to archive it. */
import { Skeleton } from "@/components/feedback/skeleton"
import GlideMenu from "@/components/primitives/GlideMenu"
import { cn } from "@/lib/utils"
import type { Room } from "@ea/modules/chat/domain/Room"
import { useAtomRefresh, useAtomSet } from "@effect/atom-react"
import { Archive } from "lucide-react"
import { archiveRoomAtom, roomsAtom } from "../api/room-atoms.ts"

export function ChannelList(props: {
  readonly channels: ReadonlyArray<Room>
  readonly currentId: string | undefined
  readonly onSelect: (roomId: string | undefined) => void
}) {
  const archive = useAtomSet(archiveRoomAtom, { mode: "promise" })
  const refreshRooms = useAtomRefresh(roomsAtom)

  return (
    <GlideMenu highlightClassName="inset-x-0 rounded-control bg-hover">
      <ol className="flex flex-col gap-0.5">
        {props.channels.map((room) => (
          <li key={room.id} className="group flex items-center gap-1">
            <button
              type="button"
              data-menu-row
              onClick={() => props.onSelect(room.id)}
              aria-current={room.id === props.currentId ? "true" : undefined}
              className={cn(
                "relative z-10 flex flex-1 items-center gap-2 rounded-control px-2 py-1.5 text-left text-[13px] text-ink-2",
                "transition-[color,transform] duration-150 hover:text-ink active:scale-[0.98] focus-visible:outline-none",
                room.id === props.currentId && "bg-hover-2 font-medium text-ink"
              )}
            >
              <span className="truncate"># {room.slug}</span>
              {
                /*
                 * The badge counts what SOMEBODY ELSE said and you have not read — never your own messages, or
                 * posting would feel like falling behind. Absent at zero rather than showing "0", which is noise on
                 * every row of a quiet list.
                 */
              }
              {room.unreadCount === 0 ? null : (
                <span
                  aria-label={`${room.unreadCount} ongelezen`}
                  className="ml-auto rounded-full bg-red px-1.5 text-[11px] leading-[18px] font-medium text-white tabular-nums"
                >
                  {room.unreadCount}
                </span>
              )}
            </button>
            <button
              type="button"
              title="Kanaal archiveren"
              aria-label="Kanaal archiveren"
              /*
               * Archive, never delete. The conversation in a channel is the argument about decisions made in it, and a
               * product claiming a year-old decision is auditable should not offer to destroy that with one click.
               * Archiving is reversible and keeps every message readable.
               */
              onClick={async () => {
                await archive({ payload: { roomId: room.id as never, archived: true } })
                refreshRooms()
                if (room.id === props.currentId) props.onSelect(undefined)
              }}
              className="relative z-10 rounded-control p-1.5 text-ink-3 opacity-60 transition hover:bg-hover hover:text-ink group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            >
              <Archive className="size-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ol>
    </GlideMenu>
  )
}

/** The list's shape while it loads in the browser. */
export function ChannelListSkeleton() {
  return (
    <div role="status" aria-label="Kanalen laden" className="flex flex-col gap-2 px-2 py-1">
      {[0, 1, 2].map((row) => <Skeleton key={row} className={row === 1 ? "h-4 w-24" : "h-4 w-32"} />)}
    </div>
  )
}
