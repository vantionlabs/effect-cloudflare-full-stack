/**
 * Payment terms per customer: how many days after an invoice is issued it falls due.
 *
 * Keyed by the customer's email — the one stable identity a quote carries. A customer without terms pays within the
 * default. An invoice copies the terms into its due date when it is issued, so changing or clearing them here moves
 * the NEXT invoice, never one already sent.
 */
import { Button } from "@/components/atoms/Button"
import { type Column, DataTable } from "@/components/data/data-table"
import { Notice } from "@/components/feedback/notice"
import { Input } from "@/components/ui/input"
import { customerTermsAtom, setCustomerTermsAtom, TERMS_KEY } from "@/features/sales/api/sales-atoms"
import { useHydrated } from "@/hooks/use-hydrated"
import { describeFailure } from "@/lib/failure"
import { formatMoment, plural } from "@/lib/format"
import type { CustomerTerms as Terms } from "@ea/modules/sales/domain/Work"
import { PAYMENT_TERMS_DAYS } from "@ea/modules/shared/domain/Money"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Exit } from "effect"
import { useState } from "react"
import { SALES_FAILURES } from "../sales-failures.ts"

export function CustomerTerms() {
  const hydrated = useHydrated()
  const terms = useAtomValue(customerTermsAtom)
  const setTerms = useAtomSet(setCustomerTermsAtom, { mode: "promiseExit" })
  const [email, setEmail] = useState("")
  const [days, setDays] = useState("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | undefined>(undefined)

  const save = async (customerEmail: string, termsDays: number | null) => {
    setBusy(true)
    setProblem(undefined)
    const exit = await setTerms({ payload: { customerEmail, termsDays }, reactivityKeys: [TERMS_KEY, "planning"] })
    setBusy(false)
    if (Exit.isFailure(exit)) {
      setProblem(describeFailure(exit, SALES_FAILURES))
      return false
    }
    return true
  }

  const columns: ReadonlyArray<Column<Terms>> = [
    { key: "email", header: "Customer email", cell: (row) => row.customerEmail },
    { key: "days", header: "Terms", align: "right", cell: (row) => plural(row.termsDays, "day") },
    {
      key: "updated",
      header: "Changed",
      cell: (row) => <span className="text-ink-2">{formatMoment(row.updatedAt)}</span>
    },
    {
      key: "clear",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (row) => (
        <Button
          variant="quiet"
          size="xs"
          disabled={!hydrated || busy}
          aria-label={`Use default terms for ${row.customerEmail}`}
          onClick={() => void save(row.customerEmail, null)}
        >
          Use default
        </Button>
      )
    }
  ]

  return (
    <div className="flex flex-col gap-3">
      <form
        method="post"
        aria-label="Set payment terms"
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (event) => {
          event.preventDefault()
          // Whole days only; anything else is refused here rather than rounded, and the server checks the range.
          if (!/^\d+$/.test(days.trim())) return setProblem("Enter the terms as a whole number of days, e.g. 14.")
          if (await save(email, Number(days.trim()))) {
            setEmail("")
            setDays("")
          }
        }}
      >
        <Input
          aria-label="Customer email"
          type="email"
          placeholder="customer@example.com"
          className="w-64"
          value={email}
          disabled={!hydrated}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Input
          aria-label="Payment terms in days"
          inputMode="numeric"
          placeholder={`Days, e.g. ${PAYMENT_TERMS_DAYS}`}
          className="w-36"
          value={days}
          disabled={!hydrated}
          onChange={(event) => setDays(event.target.value)}
        />
        <Button
          variant="primary"
          size="sm"
          type="submit"
          disabled={!hydrated || busy || email.trim() === "" || days.trim() === ""}
        >
          Save terms
        </Button>
      </form>
      {problem === undefined ? null : <Notice tone="error">{problem}</Notice>}
      {terms._tag !== "Success"
        ? (
          <p className="text-sm text-ink-2">
            {terms._tag === "Failure" ? "Payment terms could not be loaded." : "Loading payment terms…"}
          </p>
        )
        : (
          <DataTable
            caption="Customer payment terms"
            rows={terms.value}
            columns={columns}
            rowKey={(row) => row.customerEmail}
            empty={`Every customer pays within the default ${PAYMENT_TERMS_DAYS} days.`}
          />
        )}
    </div>
  )
}
