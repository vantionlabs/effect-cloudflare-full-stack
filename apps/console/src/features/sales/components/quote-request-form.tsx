/**
 * Paste a customer's request; the model DRAFTS a quote from it. The model only points at what was asked for and picks
 * products — every price comes from the price list and every total is computed in integer cents. Nothing is sent.
 */
import { Button } from "@/components/atoms/Button"
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
        aria-label="Customer request"
        className="min-h-28"
        placeholder="Paste the customer's email or message here."
        value={request}
        disabled={!hydrated}
        onChange={(event) => setRequest(event.target.value)}
      />
      <div>
        <Button variant="primary" type="submit" disabled={!hydrated || drafting || request.trim() === ""}>
          {drafting ? "Reading the request…" : "Draft quote"}
        </Button>
      </div>
    </form>
  )
}
