/**
 * The reviewer's console: the queue on the left, the decision under inspection on the right.
 *
 * Keyboard-first (`j`/`k`/`a`/`r`) because the job is repetitive triage and a reviewer working through forty
 * invoices should not be moving a mouse. The keys are bound once in the page rather than per row, so focus never
 * decides whether a shortcut works.
 */
import { QueuePage } from "@/features/queue/queue-page"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/")({
  component: QueuePage
})
