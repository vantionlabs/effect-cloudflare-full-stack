/**
 * Ask the technical documentation — a new conversation. The loader server-renders the documents and the person's
 * conversation list (`rpc/dehydrate.ts`), so the page arrives complete and the browser does not fetch them again.
 */
import { loadAskPage } from "@/features/ask/api/load-ask-page"
import { AskPage } from "@/features/ask/ask-page"
import { HydrationBoundary } from "@effect/atom-react"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/ask/")({
  loader: () => loadAskPage({ data: {} }),
  component: NewConversationRoute
})

function NewConversationRoute() {
  return (
    <HydrationBoundary state={Route.useLoaderData()}>
      <AskPage conversationId={undefined} />
    </HydrationBoundary>
  )
}
