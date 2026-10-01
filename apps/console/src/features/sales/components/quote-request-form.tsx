/**
 * Paste a customer's request; the model DRAFTS a quote from it. The model only points at what was asked for and picks
 * products — every price comes from the price list and every total is computed in integer cents. Nothing is sent.
 */
import { Button } from "@/components/atoms/Button"
import { Shimmer } from "@/components/atoms/Shimmer"
import { Textarea } from "@/components/ui/textarea"
import { draftQuoteAtom, QUOTES_KEY } from "@/features/sales/api/sales-atoms"
import { useHydrated } from "@/hooks/use-hydrated"
import { describeFailure } from "@/lib/failure"
import { useAtomSet } from "@effect/atom-react"
import { Exit } from "effect"
import { useState } from "react"
import { SALES_FAILURES } from "../sales-failures.ts"

export function QuoteRequestForm(props: { readonly onFailure: (message: string | undefined) => void }) {
  const hydrated = useHydrated()
  const draftQuote = useAtomSet(draftQuoteAtom, { mode: "promiseExit" })
  const [request, setRequest] = useState("")
  const [drafting, setDrafting] = useState(false)

  return (
    <form
      method="post"
      className="flex flex-col gap-3"
      onSubmit={async (event) => {
        event.preventDefault()
        if (request.trim() === "") return
        setDrafting(true)
        props.onFailure(undefined)
        const exit = await draftQuote({ payload: { request }, reactivityKeys: [QUOTES_KEY] })
        if (Exit.isSuccess(exit)) setRequest("")
        else props.onFailure(describeFailure(exit, SALES_FAILURES))
        setDrafting(false)
      }}
    >
      <Textarea
        aria-label="Klantvraag"
        className="min-h-28"
        placeholder="Plak hier de e-mail of het bericht van de klant."
        value={request}
        disabled={!hydrated}
        onChange={(event) => setRequest(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" type="submit" disabled={!hydrated || drafting || request.trim() === ""}>
          {drafting ? <Shimmer>De vraag wordt gelezen…</Shimmer> : "Offerte opstellen"}
        </Button>
        <span className="text-[12px] text-ink-3">Er wordt nog niets verstuurd: je krijgt eerst een concept.</span>
      </div>
    </form>
  )
}
