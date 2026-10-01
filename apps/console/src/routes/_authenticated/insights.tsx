/** Insights — see `features/insights/insights-page.tsx`. No loader: the page has no data until a question is asked. */
import { InsightsPage } from "@/features/insights/insights-page"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/insights")({ component: InsightsPage })
