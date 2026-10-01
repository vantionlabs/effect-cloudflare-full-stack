/** Usage — see `features/usage/usage-page.tsx`. Server-rendered: the loader dehydrates the report atom. */
import { loadUsagePage } from "@/features/usage/api/load-usage-page"
import { UsagePage } from "@/features/usage/usage-page"
import { HydrationBoundary } from "@effect/atom-react"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/usage")({
  loader: () => loadUsagePage(),
  component: UsageRoute
})

function UsageRoute() {
  return (
    <HydrationBoundary state={Route.useLoaderData()}>
      <UsagePage />
    </HydrationBoundary>
  )
}
