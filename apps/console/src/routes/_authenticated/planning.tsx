/** Planning — see `features/planning/planning-page.tsx`. Server-rendered: the loader dehydrates the page's atoms. */
import { loadPlanningPage } from "@/features/planning/api/load-planning-page"
import { PlanningPage } from "@/features/planning/planning-page"
import { HydrationBoundary } from "@effect/atom-react"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/planning")({
  loader: () => loadPlanningPage(),
  component: PlanningRoute
})

function PlanningRoute() {
  return (
    <HydrationBoundary state={Route.useLoaderData()}>
      <PlanningPage />
    </HydrationBoundary>
  )
}
