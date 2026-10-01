/** What each planning action's typed failure says to the person. See `lib/failure.ts`. */
import type { FailureMessages } from "@/lib/failure"

export const PLANNING_FAILURES: FailureMessages = {
  JobNotInState: "Someone already did that. The page has been refreshed.",
  JobNotFound: "That job no longer exists. The page has been refreshed.",
  InvoiceAlreadyPaid: "Someone already did that. The page has been refreshed.",
  InvoiceNotFound: "That invoice no longer exists. The page has been refreshed.",
  InvalidExpense: (failure) => `That expense was not accepted: ${failure.reason ?? "check the fields"}.`,
  ExpenseNotFound: "That expense was already stopped. The page has been refreshed."
}
