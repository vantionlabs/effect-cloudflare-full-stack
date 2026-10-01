/**
 * A destructive action that asks once, in place: the button becomes "Zeker weten?" with the real action and a way
 * back, instead of opening a modal for a question that needs neither interruption nor protected focus.
 */
import { Button } from "@/components/atoms/Button"
import { useState } from "react"

export function ConfirmAction(props: {
  readonly label: string
  readonly confirmLabel: string
  readonly disabled: boolean
  readonly onConfirm: () => void
  /** Names the target for assistive technology, e.g. "Intrekken: ann@example.com". */
  readonly accessibleLabel: string
}) {
  const [asking, setAsking] = useState(false)
  if (!asking) {
    return (
      <Button
        variant="quiet"
        size="xs"
        disabled={props.disabled}
        aria-label={props.accessibleLabel}
        onClick={() => setAsking(true)}
      >
        {props.label}
      </Button>
    )
  }
  return (
    <span className="inline-flex items-center gap-1" style={{ animation: "fade-in 150ms ease-out both" }}>
      <Button
        variant="secondary"
        size="xs"
        className="text-red"
        disabled={props.disabled}
        onClick={() => {
          setAsking(false)
          props.onConfirm()
        }}
      >
        {props.confirmLabel}
      </Button>
      <Button variant="quiet" size="xs" onClick={() => setAsking(false)}>Annuleren</Button>
    </span>
  )
}
