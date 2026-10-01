/**
 * Payment terms per customer: how many days after an invoice is issued it falls due.
 *
 * Keyed by the customer's email — the one stable identity a quote carries. A customer without terms pays within the
 * default. An invoice copies the terms into its due date when it is issued, so changing or clearing them here moves
 * the NEXT invoice, never one already sent.
 *
 * The days are a scrub field (Beautiful UI's, from FineTuneCard): drag the label, use the arrow keys (Shift for ten),
 * or type. It starts at the default, so the common case — a customer who gets 14 days — is a few keystrokes.
 */
import { Button } from "@/components/atoms/Button"
import { Shimmer } from "@/components/atoms/Shimmer"
import { type Column, DataTable } from "@/components/data/data-table"
import { Notice } from "@/components/feedback/notice"
import { SkeletonTable } from "@/components/feedback/skeleton"
import { ScrubField } from "@/components/primitives/FineTuneCard"
import { Input } from "@/components/ui/input"
import { customerTermsAtom, setCustomerTermsAtom, TERMS_KEY } from "@/features/sales/api/sales-atoms"
import { useHydrated } from "@/hooks/use-hydrated"
import { describeFailure } from "@/lib/failure"
import { formatMoment, plural } from "@/lib/format"
import { superseded } from "@/lib/motion"
import type { CustomerTerms as Terms } from "@ea/modules/sales/domain/Work"
import { PAYMENT_TERMS_DAYS } from "@ea/modules/shared/domain/Money"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Exit } from "effect"
import { useState } from "react"
import { SALES_FAILURES } from "../sales-failures.ts"

const MAX_TERMS_DAYS = 365

export function CustomerTerms() {
  const hydrated = useHydrated()
  const terms = useAtomValue(customerTermsAtom)
  const setTerms = useAtomSet(setCustomerTermsAtom, { mode: "promiseExit" })
  const [email, setEmail] = useState("")
  const [days, setDays] = useState<number>(PAYMENT_TERMS_DAYS)
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
    { key: "email", header: "E-mail klant", cell: (row) => row.customerEmail },
    {
      key: "days",
      header: "Termijn",
      align: "right",
      cell: (row) => <span className="whitespace-nowrap">{plural(row.termsDays, "dag", "dagen")}</span>
    },
    {
      key: "updated",
      header: "Gewijzigd",
      cell: (row) => <span className="whitespace-nowrap text-ink-2">{formatMoment(row.updatedAt)}</span>
    },
    {
      key: "clear",
      header: <span className="sr-only">Acties</span>,
      align: "right",
      cell: (row) => (
        <Button
          variant="quiet"
          size="xs"
          disabled={!hydrated || busy}
          aria-label={`Standaardtermijn gebruiken voor ${row.customerEmail}`}
          onClick={() => void save(row.customerEmail, null)}
        >
          Standaard gebruiken
        </Button>
      )
    }
  ]

  return (
    <div className="flex flex-col gap-3">
      <form
        method="post"
        aria-label="Betalingstermijn instellen"
        className="flex flex-wrap items-center gap-2 rounded-card bg-surface p-3 shadow-card"
        onSubmit={async (event) => {
          event.preventDefault()
          if (await save(email, days)) {
            setEmail("")
            setDays(PAYMENT_TERMS_DAYS)
          }
        }}
      >
        <Input
          aria-label="E-mail klant"
          type="email"
          placeholder="klant@voorbeeld.nl"
          className="w-64"
          value={email}
          disabled={!hydrated}
          onChange={(event) => setEmail(event.target.value)}
        />
        <div className="w-44">
          <ScrubField
            label="Termijn"
            inputLabel="Betalingstermijn in dagen"
            value={days}
            onChange={setDays}
            min={0}
            max={MAX_TERMS_DAYS}
            suffix="dagen"
            disabled={!hydrated}
          />
        </div>
        <Button variant="primary" size="sm" type="submit" disabled={!hydrated || busy || email.trim() === ""}>
          {busy ? <Shimmer>Opslaan…</Shimmer> : "Termijn opslaan"}
        </Button>
      </form>
      {problem === undefined ? null : <Notice tone="error">{problem}</Notice>}
      {terms._tag === "Initial"
        ? <SkeletonTable rows={2} columns={3} label="Betalingstermijnen worden geladen" />
        : terms._tag === "Failure"
        ? <Notice tone="error">De betalingstermijnen konden niet worden geladen.</Notice>
        : (
          <div style={superseded(terms.waiting)} aria-busy={terms.waiting}>
            <DataTable
              caption="Betalingstermijnen per klant"
              rows={terms.value}
              columns={columns}
              rowKey={(row) => row.customerEmail}
              empty={`Elke klant betaalt binnen de standaardtermijn van ${PAYMENT_TERMS_DAYS} dagen. Stel hierboven een andere termijn in voor een klant die dat heeft afgesproken.`}
            />
          </div>
        )}
    </div>
  )
}
