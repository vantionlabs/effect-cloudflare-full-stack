/**
 * Sales: the price list, and quotes from a customer's request to the customer's inbox.
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
        title="Sales"
        description="Paste a customer's request to draft a quote. Prices come from your price list; you approve before anything is sent."
      />

      <PageSection id="new-quote" title="New quote from a request">
        <Panel>
          <QuoteRequestForm onFailure={setNote} />
        </Panel>
      </PageSection>

      {note === undefined ? null : <Notice tone="error">{note}</Notice>}

      <PageSection id="quotes" title="Quotes">
        <QuoteList onFailure={setNote} />
      </PageSection>

      <PageSection
        id="price-list-changes"
        title="Change the price list by asking"
        description='E.g. "raise SV-350 to 199 and stop offering OLD-1". You get proposals to approve; nothing changes until you apply one.'
      >
        <PriceListChanges />
      </PageSection>

      <PageSection id="price-list" title="Price list" description="The only source of prices on a quote.">
        <ProductTable />
        <Panel>
          <ProductForm />
        </Panel>
      </PageSection>

      <PageSection
        id="payment-terms"
        title="Payment terms"
        description={`How many days after an invoice is issued it falls due, per customer. Customers not listed pay within ${PAYMENT_TERMS_DAYS} days. A change applies to the next invoice, never one already sent.`}
      >
        <CustomerTerms />
      </PageSection>
    </Page>
  )
}
