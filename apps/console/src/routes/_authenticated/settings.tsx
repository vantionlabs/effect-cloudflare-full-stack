import { loadSettingsAtoms } from "@/features/settings/api/load-settings-atoms"
import { loadSettingsPage } from "@/features/settings/api/load-settings-page"
import { SettingsSkeleton } from "@/features/settings/components/settings-skeleton"
import { SettingsPage } from "@/features/settings/settings-page"
import { HydrationBoundary } from "@effect/atom-react"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/settings")({
  // better-auth's view of the team (a server function over its client) and the RPC-backed parts, in parallel.
  loader: async () => {
    const [view, atoms] = await Promise.all([loadSettingsPage(), loadSettingsAtoms()])
    return { view, atoms }
  },
  pendingComponent: SettingsSkeleton,
  component: SettingsRoute
})

function SettingsRoute() {
  const { view, atoms } = Route.useLoaderData()
  return (
    <HydrationBoundary state={atoms}>
      <SettingsPage view={view} />
    </HydrationBoundary>
  )
}
