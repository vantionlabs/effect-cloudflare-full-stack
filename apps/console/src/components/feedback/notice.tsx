/**
 * A message the person needs to read: why an action failed, or what a figure assumes.
 *
 * `role="alert"` only for errors, so a screen reader interrupts for a failure and not for an explanation.
 */
import { cn } from "@/lib/utils"
import { AlertCircle, Info } from "lucide-react"
import type { ReactNode } from "react"

export function Notice(props: { readonly tone?: "info" | "error"; readonly children: ReactNode }) {
  const error = props.tone === "error"
  const Icon = error ? AlertCircle : Info
  return (
    <div
      role={error ? "alert" : undefined}
      className={cn(
        "flex items-start gap-2 rounded-control px-3 py-2 text-[13px]",
        error ? "bg-red-tint text-red" : "bg-inset text-ink-2"
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>{props.children}</div>
    </div>
  )
}
