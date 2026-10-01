/**
 * Ask the technical documentation.
 *
 * Effect Atom's SSR: the loader runs the documents atom on the server and dehydrates it (`rpc/dehydrate.ts`), and
 * the page reads it with `useAtomValue` inside `HydrationBoundary` — so the HTML arrives listing the manuals and the
 * browser does not fetch them again. Everything goes through the console's own RPC; the public v1 HTTP API is for
 * third parties.
 */
import { loadAskPage } from "@/features/ask/api/load-ask-page"
import { AskPage } from "@/features/ask/ask-page"
import { HydrationBoundary } from "@effect/atom-react"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/ask")({
  loader: () => loadAskPage(),
  component: AskRoute
})

function AskRoute() {
  return (
    <HydrationBoundary state={Route.useLoaderData()}>
      <AskPage />
    </HydrationBoundary>
  )
}
