import { loadSettingsPage } from "@/features/settings/api/load-settings-page"
import { SettingsSkeleton } from "@/features/settings/components/settings-skeleton"
import { SettingsPage } from "@/features/settings/settings-page"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/settings")({
  loader: () => loadSettingsPage(),
  pendingComponent: SettingsSkeleton,
  component: SettingsRoute
})

function SettingsRoute() {
  return <SettingsPage view={Route.useLoaderData()} />
}
