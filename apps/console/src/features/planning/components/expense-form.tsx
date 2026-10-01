/**
 * Records an expected payment out: once on a day, or monthly from that day.
 *
 * The amount is typed in euros and converted to integer cents by STRING parsing (`parseScaledInteger`, the same
 * parser the price list uses) — never `Number(x) * 100`, which turns 0,29 into 28.999… and rounds a cent away.
 */
import { Button } from "@/components/atoms/Button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { useHydrated } from "@/hooks/use-hydrated"
import { parseScaledInteger } from "@ea/modules/shared/domain/Money"
import { Result } from "effect"
import { useState } from "react"

export interface NewExpense {
  readonly description: string
  readonly amountCents: number
  readonly startsOn: string
  readonly repeat: "once" | "monthly"
}

export function ExpenseForm(props: {
  readonly today: string
  /** Resolves true when the expense was added, so the form clears only then. */
  readonly onAdd: (expense: NewExpense) => Promise<boolean>
}) {
  const hydrated = useHydrated()
  const [description, setDescription] = useState("")
  const [amount, setAmount] = useState("")
  const [startsOn, setStartsOn] = useState(props.today)
  const [repeat, setRepeat] = useState<"once" | "monthly">("once")
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  return (
    <form
      method="post"
      aria-label="Add expense"
      className="grid grid-cols-1 gap-3 rounded-card bg-surface p-4 shadow-card sm:grid-cols-[2fr_1fr_1fr_1fr_auto] sm:items-end"
      onSubmit={async (event) => {
        event.preventDefault()
        setProblem(undefined)
        const cents = parseScaledInteger(amount.trim(), 2)
        if (Result.isFailure(cents) || cents.success <= 0) return setProblem("Enter the amount like 1.250,00.")
        setBusy(true)
        const added = await props.onAdd({ description, amountCents: cents.success, startsOn, repeat })
        setBusy(false)
        if (added) {
          setDescription("")
          setAmount("")
        }
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="expense-description">Description</Label>
        <Input
          id="expense-description"
          value={description}
          maxLength={200}
          required
          disabled={!hydrated}
          placeholder="Rent, payroll, supplier…"
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="expense-amount">Amount (€)</Label>
        <Input
          id="expense-amount"
          inputMode="decimal"
          value={amount}
          required
          disabled={!hydrated}
          placeholder="1.250,00"
          onChange={(event) => setAmount(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="expense-date">First payment</Label>
        <Input
          id="expense-date"
          type="date"
          value={startsOn}
          required
          disabled={!hydrated}
          onChange={(event) => setStartsOn(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="expense-repeat">Repeats</Label>
        <NativeSelect
          id="expense-repeat"
          value={repeat}
          disabled={!hydrated}
          onChange={(event) => setRepeat(event.target.value === "monthly" ? "monthly" : "once")}
        >
          <NativeSelectOption value="once">Once</NativeSelectOption>
          <NativeSelectOption value="monthly">Monthly</NativeSelectOption>
        </NativeSelect>
      </div>
      <Button type="submit" variant="primary" disabled={!hydrated || busy}>
        {busy ? "Adding…" : "Add expense"}
      </Button>
      {problem === undefined ? null : <p role="alert" className="text-[13px] text-red sm:col-span-5">{problem}</p>}
    </form>
  )
}
