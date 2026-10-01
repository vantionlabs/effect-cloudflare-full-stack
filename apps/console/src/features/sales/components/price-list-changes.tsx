/**
 * "Change the price list by asking": an instruction becomes PROPOSALS, each shown as a field diff (now → becomes),
 * and nothing changes until a person applies one. Refusals are the tools' own reasons (a price not in the
 * instruction, an unknown SKU), so the person knows exactly what was not done.
 */
import { Button } from "@/components/atoms/Button"
import { Shimmer } from "@/components/atoms/Shimmer"
import { Notice } from "@/components/feedback/notice"
import { Input } from "@/components/ui/input"
import {
  applyChangeAtom,
  CHANGES_KEY,
  changesAtom,
  PRODUCTS_KEY,
  proposeChangesAtom,
  rejectChangeAtom
} from "@/features/sales/api/sales-atoms"
import { useArrivals } from "@/hooks/use-arrivals"
import { useHydrated } from "@/hooks/use-hydrated"
import { describeFailure } from "@/lib/failure"
import { enter } from "@/lib/motion"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Exit } from "effect"
import { useState } from "react"
import { SALES_FAILURES } from "../sales-failures.ts"
import { ProposalCard } from "./proposal-card.tsx"

export function PriceListChanges() {
  const hydrated = useHydrated()
  const changes = useAtomValue(changesAtom)
  const propose = useAtomSet(proposeChangesAtom, { mode: "promiseExit" })
  const apply = useAtomSet(applyChangeAtom, { mode: "promiseExit" })
  const reject = useAtomSet(rejectChangeAtom, { mode: "promiseExit" })
  const [instruction, setInstruction] = useState("")
  const [busy, setBusy] = useState(false)
  const [refusals, setRefusals] = useState<ReadonlyArray<string>>([])
  const [note, setNote] = useState<string | undefined>(undefined)

  const decide = async (changeId: string, action: typeof apply) => {
    setNote(undefined)
    const exit = await action({ payload: { changeId }, reactivityKeys: [CHANGES_KEY, PRODUCTS_KEY] })
    if (Exit.isFailure(exit)) setNote(describeFailure(exit, SALES_FAILURES))
  }

  const pending = changes._tag === "Success" ? changes.value.filter((change) => change.status === "pending") : []
  const arrived = useArrivals(pending, (change) => change.id)

  return (
    <div className="flex flex-col gap-3">
      <form
        method="post"
        className="flex gap-2"
        onSubmit={async (event) => {
          event.preventDefault()
          if (instruction.trim() === "") return
          setBusy(true)
          setNote(undefined)
          const exit = await propose({ payload: { instruction }, reactivityKeys: [CHANGES_KEY] })
          if (Exit.isSuccess(exit)) {
            setRefusals(exit.value.refusals)
            setInstruction("")
          } else setNote(describeFailure(exit, SALES_FAILURES))
          setBusy(false)
        }}
      >
        <Input
          aria-label="Opdracht voor de prijslijst"
          placeholder="Verhoog SV-350 naar 199 en stop met OLD-1"
          value={instruction}
          maxLength={1000}
          disabled={!hydrated}
          onChange={(event) => setInstruction(event.target.value)}
        />
        <Button variant="primary" type="submit" disabled={!hydrated || busy || instruction.trim() === ""}>
          {busy ? <Shimmer>Bezig…</Shimmer> : "Voorstellen"}
        </Button>
      </form>
      {refusals.length === 0 ? null : (
        <Notice>
          <span className="font-medium text-ink">Niet voorgesteld</span>
          <ul className="mt-1 list-disc pl-4" aria-label="Niet voorgesteld">
            {refusals.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </Notice>
      )}
      {note === undefined ? null : <Notice tone="error">{note}</Notice>}
      {pending.length === 0 ? null : (
        <div className="grid gap-3 sm:grid-cols-2">
          {pending.map((change) => (
            <div key={change.id} style={arrived.has(change.id) ? enter(arrived.get(change.id)) : undefined}>
              <ProposalCard
                change={change}
                disabled={!hydrated}
                onApply={() =>
                  void decide(change.id, apply)}
                onReject={() =>
                  void decide(change.id, reject)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
