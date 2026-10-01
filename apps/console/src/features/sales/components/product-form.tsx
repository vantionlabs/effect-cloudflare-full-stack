/** Adds a product to the price list. The price is typed in euros and parsed to cents exactly — never a float. */
import { Button } from "@/components/atoms/Button"
import { Notice } from "@/components/feedback/notice"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { PRODUCTS_KEY, upsertProductAtom } from "@/features/sales/api/sales-atoms"
import { useHydrated } from "@/hooks/use-hydrated"
import { describeFailure } from "@/lib/failure"
import { parseScaledInteger } from "@ea/modules/shared/domain/Money"
import { useAtomSet } from "@effect/atom-react"
import { Exit, Result } from "effect"
import { useState } from "react"
import { SALES_FAILURES } from "../sales-failures.ts"
import { type Unit, UNIT_LABEL, UNITS } from "../units.ts"

export function ProductForm() {
  const hydrated = useHydrated()
  const upsertProduct = useAtomSet(upsertProductAtom, { mode: "promiseExit" })
  const [sku, setSku] = useState("")
  const [name, setName] = useState("")
  const [unit, setUnit] = useState<Unit>("piece")
  const [price, setPrice] = useState("")
  const [vat, setVat] = useState(210)
  const [problem, setProblem] = useState<string | undefined>(undefined)

  return (
    <form
      method="post"
      className="flex flex-col gap-3"
      aria-label="Product toevoegen"
      onSubmit={async (event) => {
        event.preventDefault()
        // Euros as typed ("42,50"), to cents with the same parser the product uses everywhere — never a float.
        const cents = parseScaledInteger(price, 2)
        if (Result.isFailure(cents)) return setProblem("Vul de prijs in zoals 42,50.")
        const exit = await upsertProduct({
          payload: { sku, name, unit, unitPrice: cents.success, vat, active: true },
          reactivityKeys: [PRODUCTS_KEY]
        })
        if (Exit.isFailure(exit)) return setProblem(describeFailure(exit, SALES_FAILURES))
        setProblem(undefined)
        setSku("")
        setName("")
        setPrice("")
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <Input
          aria-label="Artikelnummer"
          placeholder="Artikelnummer"
          className="w-32"
          value={sku}
          disabled={!hydrated}
          onChange={(e) => setSku(e.target.value)}
        />
        <Input
          aria-label="Productnaam"
          placeholder="Naam"
          className="w-56"
          value={name}
          disabled={!hydrated}
          onChange={(e) => setName(e.target.value)}
        />
        <NativeSelect
          aria-label="Eenheid"
          value={unit}
          disabled={!hydrated}
          onChange={(e) => setUnit(e.target.value as Unit)}
        >
          {UNITS.map((u) => <NativeSelectOption key={u} value={u}>{UNIT_LABEL[u]}</NativeSelectOption>)}
        </NativeSelect>
        <Input
          aria-label="Prijs"
          placeholder="Prijs, bijv. 42,50"
          className="w-36"
          value={price}
          disabled={!hydrated}
          onChange={(e) => setPrice(e.target.value)}
        />
        <NativeSelect
          aria-label="Btw"
          value={vat}
          disabled={!hydrated}
          onChange={(e) => setVat(Number(e.target.value))}
        >
          <NativeSelectOption value={210}>21%</NativeSelectOption>
          <NativeSelectOption value={90}>9%</NativeSelectOption>
          <NativeSelectOption value={0}>0%</NativeSelectOption>
        </NativeSelect>
        <Button
          variant="primary"
          type="submit"
          size="sm"
          disabled={!hydrated || sku.trim() === "" || name.trim() === "" || price === ""}
        >
          Product toevoegen
        </Button>
      </div>
      {problem === undefined ? null : <Notice tone="error">{problem}</Notice>}
    </form>
  )
}
