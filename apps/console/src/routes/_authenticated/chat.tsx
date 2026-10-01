/**
 * `/chat` — the channels view.
 *
 * The selected channel is a SEARCH PARAM, not component state, so a channel is a link: somebody can paste
 * `/chat?room=…` into a message and their colleague lands in the same place. The same reasoning as `next` on the
 * login route — state that identifies what you are looking at belongs in the URL.
 */
import { ChatPage } from "@/features/chat/chat-page"
import { createFileRoute, useNavigate } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/chat")({
  /*
   * Validated rather than read raw, for the same reason `next` is on the login route: anything from a URL is
   * untrusted input. A non-string becomes undefined, which renders the first channel instead of a broken pane.
   */
  validateSearch: (search: Record<string, unknown>): { readonly room?: string } => {
    const room = search["room"]
    return typeof room === "string" && room !== "" ? { room } : {}
  },
  component: ChatRoute
})

function ChatRoute() {
  const { room } = Route.useSearch()
  const navigate = useNavigate()

  return (
    <ChatPage
      selected={room}
      onSelect={(roomId) =>
        /*
         * `replace`, so clicking through channels does not fill the back button with every one visited — the
         * back button should leave the chat, not walk it.
         */
        void navigate({ to: "/chat", search: roomId === undefined ? {} : { room: roomId }, replace: true })}
    />
  )
}
