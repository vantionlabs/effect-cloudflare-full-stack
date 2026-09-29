/**
 * The reviewer's console: the queue on the left, the decision under inspection on the right.
 *
 * Keyboard-first (`j`/`k`/`a`/`r`) because the job is repetitive triage and a reviewer working through forty
 * invoices should not be moving a mouse. The keys are bound once here rather than per row, so focus never
 * decides whether a shortcut works.
 */
import { createFileRoute } from "@tanstack/react-router"
import { QueueScreen } from "../queue-screen.tsx"

export const Route = createFileRoute("/")({
  component: QueueScreen
})
