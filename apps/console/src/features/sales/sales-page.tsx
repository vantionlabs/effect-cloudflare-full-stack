/**
 * Verkoop: the price list, and quotes from a customer's request to the customer's inbox.
 *
 * The flow the page enforces is the product's rule for every AI feature: the model proposes, code computes, a person
 * approves. Pasting a request DRAFTS a quote — the model only points at what was asked for and picks products; every
 * price comes from the price list below and every total is computed in integer cents. What the machine could not do
 * is listed on the draft as flags. Nothing reaches a customer until a person approves it and then sends it.
 *
 * Server-rendered through Effect Atom hydration (`api/sales-atoms.ts`); every action is an RPC mutation from the
 * browser, disabled until hydration for the reasons in `login.tsx`.
 */
import { Notice } from "@/components/feedback/notice"
import { Page, PageHeader, PageSection, Panel } from "@/components/layout/page"
import { PAYMENT_TERMS_DAYS } from "@ea/modules/shared/domain/Money"
import { useState } from "react"
import { CustomerTerms } from "./components/customer-terms.tsx"
import { InboundInbox } from "./components/inbound-inbox.tsx"
import { PriceListChanges } from "./components/price-list-changes.tsx"
import { ProductForm } from "./components/product-form.tsx"
import { ProductTable } from "./components/product-table.tsx"
import { QuoteList } from "./components/quote-list.tsx"
import { QuoteRequestForm } from "./components/quote-request-form.tsx"

export function SalesPage() {
  // One place for a failed quote action's explanation, so it shows above the list whichever card it came from.
  const [note, setNote] = useState<string | undefined>(undefined)

  return (
    <Page>
      <PageHeader
        title="Verkoop"
        description="Plak een klantvraag en krijg een conceptofferte. Prijzen komen uit je eigen prijslijst; niets gaat naar de klant voordat jij het goedkeurt."
      />

      <PageSection id="new-quote" title="Nieuwe offerte">
        <Panel>
          <QuoteRequestForm onFailure={setNote} />
        </Panel>
      </PageSection>

      {note === undefined ? null : <Notice tone="error">{note}</Notice>}

      <PageSection id="quotes" title="Offertes">
        <QuoteList onFailure={setNote} />
      </PageSection>

      <PageSection
        id="inbound"
        title="Binnengekomen e-mails"
        description="Wat klanten naar je offerte-adres sturen, wordt automatisch een concept. Geweigerde berichten blijven hier zichtbaar."
      >
        <InboundInbox />
      </PageSection>

      <PageSection
        id="price-list-changes"
        title="De prijslijst wijzigen met een opdracht"
        description="Bijvoorbeeld: ‘verhoog SV-350 naar 199 en stop met OLD-1’. Je krijgt voorstellen; er verandert niets tot je er een doorvoert."
      >
        <PriceListChanges />
      </PageSection>

      <PageSection id="price-list" title="Prijslijst" description="De enige bron van prijzen op een offerte.">
        <ProductTable />
        <Panel>
          <ProductForm />
        </Panel>
      </PageSection>

      <PageSection
        id="payment-terms"
        title="Betalingstermijnen"
        description={`Hoeveel dagen na het versturen een factuur moet zijn betaald, per klant. Klanten die hier niet staan betalen binnen ${PAYMENT_TERMS_DAYS} dagen. Een wijziging geldt voor de volgende factuur, nooit voor een die al verstuurd is.`}
      >
        <CustomerTerms />
      </PageSection>
    </Page>
  )
}
