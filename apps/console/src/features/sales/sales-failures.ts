/**
 * What a failed sales action says to the person, by its tag — each one a different thing for them to do.
 * Passed to `describeFailure`; a tag missing here falls back to the error's `reason`, then the tag itself.
 */
import type { FailureMessages } from "@/lib/failure"

export const SALES_FAILURES: FailureMessages = {
  QuoteNotInState: "Iemand anders heeft deze offerte al gewijzigd. De lijst is bijgewerkt.",
  QuoteNotFound: "Deze offerte bestaat niet meer. De lijst is bijgewerkt.",
  QuoteHasNoRecipient: "Deze offerte heeft geen e-mailadres van de klant om naar te sturen.",
  EmailNotSent: (failure) =>
    `De e-mail kon niet worden verstuurd (${
      failure.reason ?? "fout bij de mailprovider"
    }). De offerte blijft goedgekeurd.`,
  InvalidProduct: (failure) => failure.reason ?? "Dat product is niet geaccepteerd.",
  ChangeIsStale:
    "Het product is gewijzigd nadat dit werd voorgesteld, dus het is niet doorgevoerd. Wijs het af en vraag het opnieuw.",
  ChangeNotPending: "Iemand heeft deze wijziging al doorgevoerd of afgewezen.",
  ChangeNotFound: "Deze wijziging bestaat niet meer.",
  InvalidTerms: (failure) => failure.reason ?? "Die betalingstermijn is niet geaccepteerd."
}
