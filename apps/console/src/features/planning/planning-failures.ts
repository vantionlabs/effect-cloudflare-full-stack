/** What each planning action's typed failure says to the person. See `lib/failure.ts`. */
import type { FailureMessages } from "@/lib/failure"

export const PLANNING_FAILURES: FailureMessages = {
  JobNotInState: "Iemand anders heeft dit al gedaan. De pagina is bijgewerkt.",
  JobNotFound: "Deze opdracht bestaat niet meer. De pagina is bijgewerkt.",
  InvoiceAlreadyPaid: "Deze factuur is al als betaald vastgelegd. De pagina is bijgewerkt.",
  InvoiceNotFound: "Deze factuur bestaat niet meer. De pagina is bijgewerkt.",
  InvalidExpense: (failure) => `Deze uitgave is niet geaccepteerd: ${failure.reason ?? "controleer de velden"}.`,
  ExpenseNotFound: "Deze uitgave was al gestopt. De pagina is bijgewerkt."
}
