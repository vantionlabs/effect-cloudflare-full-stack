/** Sales — see `features/sales/sales-page.tsx`. The route only loads the page's data on the server and hydrates it. */
import { loadSalesPage } from "@/features/sales/api/load-sales-page"
import { SalesPage } from "@/features/sales/sales-page"
import { HydrationBoundary } from "@effect/atom-react"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/sales")({
  loader: () => loadSalesPage(),
  component: SalesRoute
})

function SalesRoute() {
  return (
    <HydrationBoundary state={Route.useLoaderData()}>
      <SalesPage />
    </HydrationBoundary>
  )
}
