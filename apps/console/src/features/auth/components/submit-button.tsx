/**
 * The submit button every auth form ends with.
 *
 * Disabled until hydrated, so the only way to submit is the handler that validates and posts JSON. Before that,
 * submitting could only leak a password into the URL and land on a page that cannot sign anybody in — worse than a
 * button that visibly is not ready yet. It also gives the e2e suite a real signal instead of a sleep: Playwright
 * waits for an element to be enabled before clicking, so "hydrated" becomes something a test can wait on.
 */
import { Button } from "@/components/atoms/Button"

export function SubmitButton(props: {
  readonly submitting: boolean
  readonly hydrated: boolean
  readonly label: string
  readonly busyLabel: string
}) {
  return (
    <Button variant="primary" type="submit" className="w-full" disabled={props.submitting || !props.hydrated}>
      {props.submitting ? props.busyLabel : props.label}
    </Button>
  )
}
