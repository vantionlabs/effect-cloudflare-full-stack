/**
 * One message in a thread: who and when, the body (or an editor for it), and reactions.
 */
import { Button } from "@/components/atoms/Button"
import { Input } from "@/components/ui/input"
import { formatMoment } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Message } from "@ea/modules/chat/domain/Message"
import { useAtomSet } from "@effect/atom-react"
import { useState } from "react"
import { deleteMessageAtom, editMessageAtom, QUICK_REACTIONS, reactAtom } from "./thread-atoms.ts"

export function ThreadMessage({ message, viewerId }: {
  readonly message: Message
  readonly viewerId: string
}) {
  const edit = useAtomSet(editMessageAtom, { mode: "promise" })
  const remove = useAtomSet(deleteMessageAtom, { mode: "promise" })
  const react = useAtomSet(reactAtom, { mode: "promise" })
  /** The draft while editing; one message at a time, which is all anybody does. */
  const [editing, setEditing] = useState<string | undefined>(undefined)

  return (
    <li className="flex flex-col gap-1 text-[13px]">
      <div className="flex flex-wrap items-baseline gap-x-2">
        {/* Falls back to the id when the author's row is gone — a deleted user leaves their notes. */}
        <span className="font-medium text-ink">{message.authorEmail ?? message.authorUserId}</span>
        <time dateTime={message.createdAt} className="text-[12px] text-ink-3">{formatMoment(message.createdAt)}</time>
        {/* "edited" is shown, not hidden: an edited note and an original are not the same evidence. */}
        {message.editedAt === null ? null : <span className="text-[12px] text-ink-3">· edited</span>}
        {
          /*
           * A message that names YOU is marked, using the userId rather than the email — the email is display and can
           * change, the id is the identity. This is the whole visible payoff of storing mentions: the client does not
           * parse anything, it compares ids.
           */
        }
        {message.mentions.some((mention) => mention.userId === viewerId)
          ? <span title="You were mentioned" className="text-[11px] font-semibold text-red">@you</span>
          : null}
      </div>

      {message.deletedAt !== null
        ? <div className="text-ink-3 italic">message deleted</div>
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
            <Input value={editing} onChange={(event) => setEditing(event.target.value)} aria-label="Edit message" />
            <Button type="submit" variant="primary" size="sm" className="h-8">Save</Button>
            <Button type="button" variant="quiet" size="sm" className="h-8" onClick={() => setEditing(undefined)}>
              Cancel
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
            {message.authorUserId !== viewerId ? null : (
              <span className="ml-2 inline-flex gap-1 align-middle">
                <Button type="button" variant="quiet" size="xs" onClick={() => setEditing(message.body)}>edit</Button>
                <Button
                  type="button"
                  variant="quiet"
                  size="xs"
                  onClick={() => void remove({ payload: { messageId: message.id } })}
                >
                  delete
                </Button>
              </span>
            )}
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
      <div className="flex flex-wrap items-center gap-1">
        {message.reactions.map((reaction) => (
          <button
            key={reaction.emoji}
            type="button"
            aria-pressed={reaction.mine}
            title={reaction.mine ? "Remove your reaction" : "Add your reaction"}
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
        {QUICK_REACTIONS.filter((emoji) => !message.reactions.some((reaction) => reaction.emoji === emoji)).map((
          emoji
        ) => (
          <button
            key={emoji}
            type="button"
            title={`React with ${emoji}`}
            onClick={() => void react({ payload: { messageId: message.id, emoji } })}
            className="rounded-full px-1 text-[12px] opacity-35 transition-opacity hover:opacity-100 focus-visible:opacity-100"
          >
            {emoji}
          </button>
        ))}
      </div>
    </li>
  )
}
