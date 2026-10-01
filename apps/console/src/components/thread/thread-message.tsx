/**
 * One message in a thread: who and when, the body (or an editor for it), and reactions.
 */
import { Button } from "@/components/atoms/Button"
import { EntityChip } from "@/components/atoms/EntityChip"
import { Input } from "@/components/ui/input"
import { formatMoment } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Message } from "@ea/modules/chat/domain/Message"
import { useAtomSet } from "@effect/atom-react"
import { type CSSProperties, useState } from "react"
import { deleteMessageAtom, editMessageAtom, QUICK_REACTIONS, reactAtom } from "./thread-atoms.ts"

/**
 * Controls that appear on hover or focus where a pointer can hover, and are always visible on touch screens, where
 * there is no hover to reveal them. A thread reads as conversation, not as a column of buttons.
 */
const REVEAL =
  "transition-opacity duration-150 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/message:opacity-100 [@media(hover:hover)]:group-focus-within/message:opacity-100"

export function ThreadMessage({ continued = false, message, style, viewerId }: {
  readonly message: Message
  readonly viewerId: string
  /** The same person, moments after their previous message: the name and time are not repeated. */
  readonly continued?: boolean | undefined
  /** An entrance, for a message that arrived while the thread was open. */
  readonly style?: CSSProperties | undefined
}) {
  const edit = useAtomSet(editMessageAtom, { mode: "promise" })
  const remove = useAtomSet(deleteMessageAtom, { mode: "promise" })
  const react = useAtomSet(reactAtom, { mode: "promise" })
  /** The draft while editing; one message at a time, which is all anybody does. */
  const [editing, setEditing] = useState<string | undefined>(undefined)

  /** The quick picks not already used on this message. */
  const quickPicks = QUICK_REACTIONS.filter((emoji) => !message.reactions.some((reaction) => reaction.emoji === emoji))
    .map((
      emoji
    ) => (
      <button
        key={emoji}
        type="button"
        title={`Reageren met ${emoji}`}
        onClick={() => void react({ payload: { messageId: message.id, emoji } })}
        className="rounded-full px-1 text-[12px] opacity-35 transition-opacity hover:opacity-100 focus-visible:opacity-100"
      >
        {emoji}
      </button>
    ))

  return (
    <li
      className={cn("group/message flex flex-col gap-1 text-[13px]", continued ? "pt-1.5" : "pt-4 first:pt-0")}
      style={style}
      title={continued ? formatMoment(message.createdAt) : undefined}
    >
      <div className={cn("flex flex-wrap items-baseline gap-x-2", continued && "sr-only")}>
        {/* Falls back to the id when the author's row is gone — a deleted user leaves their notes. */}
        <EntityChip name={message.authorEmail ?? message.authorUserId} className="mx-0" />
        <time dateTime={message.createdAt} className="text-[12px] text-ink-3">{formatMoment(message.createdAt)}</time>
        {/* "edited" is shown, not hidden: an edited note and an original are not the same evidence. */}
        {message.editedAt === null ? null : <span className="text-[12px] text-ink-3">· bewerkt</span>}
        {
          /*
           * A message that names YOU is marked, using the userId rather than the email — the email is display and can
           * change, the id is the identity. This is the whole visible payoff of storing mentions: the client does not
           * parse anything, it compares ids.
           */
        }
        {message.mentions.some((mention) => mention.userId === viewerId)
          ? <span title="Je wordt genoemd" className="text-[11px] font-semibold text-red">@jij</span>
          : null}
      </div>

      {message.deletedAt !== null
        ? <div className="text-ink-3 italic">bericht verwijderd</div>
        : editing !== undefined
        ? (
          <form
            method="post"
            onSubmit={(event) => {
              event.preventDefault()
              void (async () => {
                const body = editing.trim()
                if (body === "") return
                await edit({ payload: { messageId: message.id, body } })
                setEditing(undefined)
              })()
            }}
            className="flex gap-2"
          >
            <Input value={editing} onChange={(event) => setEditing(event.target.value)} aria-label="Bericht bewerken" />
            <Button type="submit" variant="primary" size="sm" className="h-8">Opslaan</Button>
            <Button type="button" variant="quiet" size="sm" className="h-8" onClick={() => setEditing(undefined)}>
              Annuleren
            </Button>
          </form>
        )
        : (
          <div className="whitespace-pre-wrap text-ink">
            {message.body}
            {
              /*
               * Only on your own messages. The server refuses anything else (`NotMessageAuthor`), so this is the UI
               * agreeing with the rule rather than enforcing it — there is deliberately no moderator override anywhere.
               */
            }
            <span className={cn("ml-2 inline-flex items-center gap-1 align-middle", REVEAL)}>
              {message.authorUserId !== viewerId ? null : (
                <>
                  <Button type="button" variant="quiet" size="xs" onClick={() => setEditing(message.body)}>
                    bewerken
                  </Button>
                  <Button
                    type="button"
                    variant="quiet"
                    size="xs"
                    onClick={() => void remove({ payload: { messageId: message.id } })}
                  >
                    verwijderen
                  </Button>
                </>
              )}
              {/* With no reactions yet, the quick picks sit here rather than on a row of their own. */}
              {message.reactions.length === 0 ? quickPicks : null}
            </span>
          </div>
        )}

      {
        /*
         * Reactions: what is already there, then the quick picks.
         *
         * Rendered for a deleted message too — people did react, and the row still records it. Hiding them would be a
         * second, quieter kind of deletion that nobody asked for.
         */
      }
      {message.reactions.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-1">
          {message.reactions.map((reaction) => (
            <button
              key={reaction.emoji}
              type="button"
              aria-pressed={reaction.mine}
              title={reaction.mine ? "Jouw reactie weghalen" : "Ook reageren"}
              onClick={() => void react({ payload: { messageId: message.id, emoji: reaction.emoji } })}
              className={cn(
                // The ring says whether YOU reacted, which is the only part that differs per reader.
                "rounded-full px-2 py-0.5 text-[12px] tabular-nums transition-colors hover:bg-hover",
                reaction.mine ? "bg-accent-tint text-accent-ink shadow-hairline" : "bg-inset text-ink-2"
              )}
            >
              {reaction.emoji} {reaction.count}
            </button>
          ))}
          {/* Reactions people left always show; the quick picks beside them appear on hover. */}
          <span className={cn("inline-flex gap-1", REVEAL)}>{quickPicks}</span>
        </div>
      )}
    </li>
  )
}
