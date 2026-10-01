/**
 * What a failed sales action says to the person, by its tag — each one a different thing for them to do.
 * Passed to `describeFailure`; a tag missing here falls back to the error's `reason`, then the tag itself.
 */
import type { FailureMessages } from "@/lib/failure"

export const SALES_FAILURES: FailureMessages = {
  QuoteNotInState: "Someone else already changed this quote. The list has been refreshed.",
  QuoteHasNoRecipient: "This quote has no customer email to send to.",
  EmailNotSent: (failure) =>
    `The email could not be sent (${failure.reason ?? "provider error"}). The quote is still approved.`,
  InvalidProduct: (failure) => failure.reason ?? "That product was not accepted.",
  ChangeIsStale: "The product changed after this was proposed, so it was not applied. Reject it and ask again.",
  ChangeNotPending: "Someone already applied or rejected this change.",
  InvalidTerms: (failure) => failure.reason ?? "Those payment terms were not accepted."
}
