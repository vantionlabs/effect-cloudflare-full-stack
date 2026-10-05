/**
 * One conversation with the documentation. The loader server-renders its history with the list and the documents,
 * so a reload — or a link to it — arrives with every turn and its sources.
 */
import { loadAskPage } from "@/features/ask/api/load-ask-page"
import { AskPage } from "@/features/ask/ask-page"
import { HydrationBoundary } from "@effect/atom-react"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/ask/$conversationId")({
  loader: ({ params }) => loadAskPage({ data: { conversationId: params.conversationId } }),
  component: ConversationRoute
})

function ConversationRoute() {
  const { conversationId } = Route.useParams()
  return (
    <HydrationBoundary state={Route.useLoaderData()}>
      <AskPage conversationId={conversationId} />
    </HydrationBoundary>
  )
}
