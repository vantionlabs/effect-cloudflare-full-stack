/**
 * The person's conversations — newest first, with Beautiful UI's gliding hover — and the way to start a new one.
 *
 * Archiving takes a conversation off this list; what was asked stays recorded in the agent (the server says so).
 */
import { Skeleton } from "@/components/feedback/skeleton"
import GlideMenu from "@/components/primitives/GlideMenu"
import { useHydrated } from "@/hooks/use-hydrated"
import { cn } from "@/lib/utils"
import type { ConversationSummary } from "@ea/modules/policy/domain/Assistant"
import { Link } from "@tanstack/react-router"
import { Archive, MessageSquarePlus } from "lucide-react"

const RELATIVE = new Intl.RelativeTimeFormat("nl", { numeric: "auto" })

/** "zojuist", "5 minuten geleden", "gisteren" — in Dutch, from the server's timestamp. */
const ago = (iso: string, now: number): string => {
  const seconds = Math.round((Date.parse(iso) - now) / 1000)
  const units: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60]
  ]
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return RELATIVE.format(Math.round(seconds / size), unit)
  }
  return "zojuist"
}

export function ConversationList(props: {
  /** `undefined` while loading in the browser; `"failed"` when the list could not be read. */
  readonly conversations: ReadonlyArray<ConversationSummary> | "failed" | undefined
  readonly activeId: string | undefined
  readonly refreshing: boolean
  readonly onArchive: (conversationId: string) => void
}) {
  const hydrated = useHydrated()
  const now = Date.now()
  return (
    <nav aria-label="Gesprekken" className="flex flex-col gap-2">
      <Link
        to="/ask"
        className={cn(
          "flex items-center gap-2 rounded-control px-2 py-1.5 text-[13px] font-medium transition-colors duration-100",
          props.activeId === undefined ? "bg-hover-2 text-ink" : "text-ink-2 hover:bg-hover hover:text-ink"
        )}
      >
        <MessageSquarePlus className="size-4" aria-hidden />
        Nieuw gesprek
      </Link>

      {props.conversations === "failed"
        ? <p role="alert" className="px-2 text-[12px] text-red">De gesprekken konden niet worden geladen.</p>
        : props.conversations === undefined
        ? (
          <div role="status" aria-label="Gesprekken laden" className="flex flex-col gap-2 px-2 pt-1">
            {[0, 1, 2].map((row) => <Skeleton key={row} className="h-8 w-full" />)}
          </div>
        )
        : props.conversations.length === 0
        ? (
          <p className="px-2 text-[12px] leading-relaxed text-ink-3">
            Je gesprekken worden hier bewaard, zodat je later kunt doorvragen.
          </p>
        )
        : (
          <GlideMenu
            highlightClassName="inset-x-0 rounded-control bg-hover"
            className={props.refreshing ? "opacity-70" : ""}
          >
            <ul className="flex flex-col" aria-label="Eerdere gesprekken">
              {props.conversations.map((conversation) => {
                const active = conversation.id === props.activeId
                return (
                  <li key={conversation.id} data-menu-row className="group relative z-10 flex items-center">
                    <Link
                      to="/ask/$conversationId"
                      params={{ conversationId: conversation.id }}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-w-0 flex-1 flex-col rounded-control px-2 py-1.5",
                        active && "bg-hover-2"
                      )}
                    >
                      <span className={cn("truncate text-[13px]", active ? "font-medium text-ink" : "text-ink-2")}>
                        {conversation.title}
                      </span>
                      <span className="text-[11px] text-ink-3">
                        {ago(conversation.updatedAt, now)} · {conversation.turnCount === 1
                          ? "1 vraag"
                          : `${conversation.turnCount} vragen`}
                      </span>
                    </Link>
                    <button
                      type="button"
                      disabled={!hydrated}
                      onClick={() => props.onArchive(conversation.id)}
                      aria-label={`Gesprek archiveren: ${conversation.title}`}
                      title="Archiveren"
                      className="absolute right-1 flex size-6 items-center justify-center rounded-[6px] text-ink-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:bg-hover-2 hover:text-ink focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                    >
                      <Archive className="size-3.5" aria-hidden />
                    </button>
                  </li>
                )
              })}
            </ul>
          </GlideMenu>
        )}
    </nav>
  )
}
