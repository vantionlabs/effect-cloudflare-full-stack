/**
 * Sales: the price list, and quotes from a customer's request to the customer's inbox.
 *
 * The flow the page enforces is the product's rule for every AI feature: the model proposes, code computes, a person
 * approves. Pasting a request DRAFTS a quote — the model only points at what was asked for and picks products; every
 * price comes from the price list below and every total is computed in integer cents. What the machine could not do
 * is listed on the draft as flags. Nothing reaches a customer until a person approves it and then sends it.
 *
 * Server-rendered through Effect Atom hydration (`sales/sales-atoms.ts`); every action is an RPC mutation from the
 * browser, disabled until hydration for the reasons in `login.tsx`.
 */
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useHydrated } from "@/hooks/use-hydrated"
import { loadSalesPage } from "@/sales/load-sales-page"
import {
  applyChangeAtom,
  approveQuoteAtom,
  CHANGES_KEY,
  changesAtom,
  discardQuoteAtom,
  draftQuoteAtom,
  PRODUCTS_KEY,
  productsAtom,
  proposeChangesAtom,
  QUOTES_KEY,
  quotesAtom,
  rejectChangeAtom,
  respondToQuoteAtom,
  sendQuoteAtom,
  upsertProductAtom
} from "@/sales/sales-atoms"
import { parseScaledInteger } from "@ea/modules/shared/domain/Money"
import { HydrationBoundary, useAtomSet, useAtomValue } from "@effect/atom-react"
import { createFileRoute } from "@tanstack/react-router"
import { Cause, Exit, Result } from "effect"
import { useState } from "react"

export const Route = createFileRoute("/_authenticated/sales")({
  loader: () => loadSalesPage(),
  component: SalesRoute
})

function SalesRoute() {
  return (
    <HydrationBoundary state={Route.useLoaderData()}>
      <SalesPage />
    </HydrationBoundary>
  )
}

const euro = (cents: number) =>
  `€ ${(cents / 100).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const quantity = (milli: number) => (milli / 1000).toLocaleString("nl-NL", { maximumFractionDigits: 3 })

/** What a failed action says to the person, by the typed failure — never "unknown error". */
const explain = (exit: Exit.Exit<unknown, unknown>): string => {
  if (Exit.isSuccess(exit)) return ""
  const failure = Cause.findErrorOption(exit.cause as Cause.Cause<{ readonly _tag?: string; readonly reason?: string }>)
  if (failure._tag === "None") return "Something went wrong."
  switch (failure.value._tag) {
    case "QuoteNotInState":
      return "Someone else already changed this quote. The list has been refreshed."
    case "QuoteHasNoRecipient":
      return "This quote has no customer email to send to."
    case "EmailNotSent":
      return `The email could not be sent (${failure.value.reason ?? "provider error"}). The quote is still approved.`
    case "InvalidProduct":
      return failure.value.reason ?? "That product was not accepted."
    case "ChangeIsStale":
      return "The product changed after this was proposed, so it was not applied. Reject it and ask again."
    case "ChangeNotPending":
      return "Someone already applied or rejected this change."
    default:
      return failure.value._tag ?? "Something went wrong."
  }
}

function SalesPage() {
  const hydrated = useHydrated()
  const products = useAtomValue(productsAtom)
  const quotes = useAtomValue(quotesAtom)
  const draftQuote = useAtomSet(draftQuoteAtom, { mode: "promiseExit" })
  const approve = useAtomSet(approveQuoteAtom, { mode: "promiseExit" })
  const discard = useAtomSet(discardQuoteAtom, { mode: "promiseExit" })
  const send = useAtomSet(sendQuoteAtom, { mode: "promiseExit" })
  const respond = useAtomSet(respondToQuoteAtom, { mode: "promiseExit" })
  const upsertProduct = useAtomSet(upsertProductAtom, { mode: "promiseExit" })

  const [request, setRequest] = useState("")
  const [drafting, setDrafting] = useState(false)
  const [busyQuote, setBusyQuote] = useState<string | undefined>(undefined)
  const [note, setNote] = useState<string | undefined>(undefined)

  const runQuote = async (
    quoteId: string,
    action: (
      args: { payload: { quoteId: string }; reactivityKeys: Array<string> }
    ) => Promise<Exit.Exit<unknown, unknown>>
  ) => {
    setBusyQuote(quoteId)
    setNote(undefined)
    const exit = await action({ payload: { quoteId }, reactivityKeys: [QUOTES_KEY] })
    if (Exit.isFailure(exit)) setNote(explain(exit))
    setBusyQuote(undefined)
  }

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-lg font-medium">Sales</h1>
        <p className="text-muted-foreground text-sm">
          Paste a customer's request to draft a quote. Prices come from your price list; you approve before anything is
          sent.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>New quote from a request</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            method="post"
            className="flex flex-col gap-3"
            onSubmit={async (event) => {
              event.preventDefault()
              if (request.trim() === "") return
              setDrafting(true)
              setNote(undefined)
              const exit = await draftQuote({ payload: { request }, reactivityKeys: [QUOTES_KEY] })
              if (Exit.isSuccess(exit)) setRequest("")
              else setNote(explain(exit))
              setDrafting(false)
            }}
          >
            <textarea
              aria-label="Customer request"
              className="border-input min-h-28 rounded-md border bg-transparent p-2 text-sm"
              placeholder="Paste the customer's email or message here."
              value={request}
              disabled={!hydrated}
              onChange={(event) => setRequest(event.target.value)}
            />
            <div>
              <Button type="submit" disabled={!hydrated || drafting || request.trim() === ""}>
                {drafting ? "Reading the request…" : "Draft quote"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {note === undefined ? null : <p className="text-sm" role="alert">{note}</p>}

      <section className="flex flex-col gap-4" aria-label="Quotes">
        {quotes._tag !== "Success"
          ? (
            <p className="text-muted-foreground text-sm">
              {quotes._tag === "Failure" ? "Quotes could not be loaded." : "Loading quotes…"}
            </p>
          )
          : quotes.value.length === 0
          ? <p className="text-muted-foreground text-sm">No quotes yet.</p>
          : quotes.value.map((quote) => (
            <Card key={quote.id} data-testid="quote">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  <span>{quote.customerName ?? "Unknown customer"}</span>
                  <span className="text-muted-foreground text-xs font-normal uppercase" data-testid="quote-status">
                    {quote.status}
                  </span>
                </CardTitle>
                <CardDescription>{quote.customerEmail ?? "no email"}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                {quote.flags.length === 0 ?
                  null :
                  (
                    <ul className="list-disc pl-5 text-amber-700 dark:text-amber-400" aria-label="Needs checking">
                      {quote.flags.map((flag) => <li key={flag}>{flag}</li>)}
                    </ul>
                  )}
                {quote.lines.length === 0 ? null : (
                  <table className="w-full">
                    <tbody>
                      {quote.lines.map((line) => (
                        <tr key={`${quote.id}-${line.sku}-${line.requestText}`} className="border-t">
                          <td className="py-1 tabular-nums">{quantity(line.quantity)} {line.unit}</td>
                          <td className="py-1">
                            {line.description} <span className="text-muted-foreground">({line.sku})</span>
                            <div className="text-muted-foreground text-xs">“{line.requestText}”</div>
                          </td>
                          <td className="py-1 text-right tabular-nums">{euro(line.unitPrice)}</td>
                          <td className="py-1 text-right tabular-nums">{euro(line.lineTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div className="text-right tabular-nums">
                  <div>Subtotal {euro(quote.subtotal)}</div>
                  <div>VAT {euro(quote.vatTotal)}</div>
                  <div className="font-medium" data-testid="quote-total">Total {euro(quote.total)}</div>
                </div>
                <div className="flex gap-2">
                  {quote.status === "draft"
                    ? (
                      <Button
                        size="sm"
                        disabled={!hydrated || busyQuote === quote.id}
                        onClick={() => void runQuote(quote.id, approve)}
                      >
                        Approve
                      </Button>
                    )
                    : null}
                  {quote.status === "approved"
                    ? (
                      <Button
                        size="sm"
                        disabled={!hydrated || busyQuote === quote.id}
                        onClick={() => void runQuote(quote.id, send)}
                      >
                        Send to customer
                      </Button>
                    )
                    : null}
                  {quote.status === "sent"
                    ? (
                      <>
                        <Button
                          size="sm"
                          disabled={!hydrated || busyQuote === quote.id}
                          onClick={async () => {
                            setBusyQuote(quote.id)
                            const exit = await respond({
                              payload: { quoteId: quote.id, accepted: true },
                              reactivityKeys: [QUOTES_KEY, "planning", "jobs"]
                            })
                            if (Exit.isFailure(exit)) setNote(explain(exit))
                            setBusyQuote(undefined)
                          }}
                        >
                          Customer accepted
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!hydrated || busyQuote === quote.id}
                          onClick={async () => {
                            setBusyQuote(quote.id)
                            const exit = await respond({
                              payload: { quoteId: quote.id, accepted: false },
                              reactivityKeys: [QUOTES_KEY, "planning"]
                            })
                            if (Exit.isFailure(exit)) setNote(explain(exit))
                            setBusyQuote(undefined)
                          }}
                        >
                          Declined
                        </Button>
                      </>
                    )
                    : null}
                  {quote.status === "draft" || quote.status === "approved"
                    ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!hydrated || busyQuote === quote.id}
                        onClick={() => void runQuote(quote.id, discard)}
                      >
                        Discard
                      </Button>
                    )
                    : null}
                  {quote.sentAt === null ?
                    null :
                    (
                      <span className="text-muted-foreground text-xs">
                        Sent {quote.sentAt.slice(0, 16).replace("T", " ")}
                      </span>
                    )}
                </div>
              </CardContent>
            </Card>
          ))}
      </section>

      <PriceListChanges hydrated={hydrated} explain={explain} />

      <Card>
        <CardHeader>
          <CardTitle>Price list</CardTitle>
          <CardDescription>The only source of prices on a quote.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {products._tag !== "Success" ? null : products.value.length === 0
            ? <p className="text-muted-foreground">No products yet.</p>
            : (
              <table className="w-full" aria-label="Products">
                <tbody>
                  {products.value.map((product) => (
                    <tr key={product.id} className={`border-t ${product.active ? "" : "text-muted-foreground"}`}>
                      <td className="py-1 font-mono text-xs">{product.sku}</td>
                      <td className="py-1">{product.name}</td>
                      <td className="py-1">{product.unit}</td>
                      <td className="py-1 text-right tabular-nums">{euro(product.unitPrice)}</td>
                      <td className="py-1 text-right tabular-nums">{product.vat / 10}% VAT</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          <ProductForm
            hydrated={hydrated}
            onSave={async (product) => {
              const exit = await upsertProduct({ payload: product, reactivityKeys: [PRODUCTS_KEY] })
              return Exit.isSuccess(exit) ? undefined : explain(exit)
            }}
          />
        </CardContent>
      </Card>
    </main>
  )
}

function ProductForm(props: {
  readonly hydrated: boolean
  readonly onSave: (product: {
    sku: string
    name: string
    unit: "piece" | "hour" | "meter" | "kilogram" | "litre"
    unitPrice: number
    vat: number
    active: boolean
  }) => Promise<string | undefined>
}) {
  const [sku, setSku] = useState("")
  const [name, setName] = useState("")
  const [unit, setUnit] = useState<"piece" | "hour" | "meter" | "kilogram" | "litre">("piece")
  const [price, setPrice] = useState("")
  const [vat, setVat] = useState(210)
  const [problem, setProblem] = useState<string | undefined>(undefined)

  return (
    <form
      method="post"
      className="flex flex-wrap items-end gap-2"
      aria-label="Add a product"
      onSubmit={async (event) => {
        event.preventDefault()
        // Euros as typed ("42,50"), to cents with the same parser the product uses everywhere — never a float.
        const cents = parseScaledInteger(price, 2)
        if (Result.isFailure(cents)) return setProblem("Enter the price like 42,50.")
        const outcome = await props.onSave({ sku, name, unit, unitPrice: cents.success, vat, active: true })
        setProblem(outcome)
        if (outcome === undefined) {
          setSku("")
          setName("")
          setPrice("")
        }
      }}
    >
      <Input
        aria-label="SKU"
        placeholder="SKU"
        className="w-28"
        value={sku}
        disabled={!props.hydrated}
        onChange={(e) => setSku(e.target.value)}
      />
      <Input
        aria-label="Product name"
        placeholder="Name"
        className="w-56"
        value={name}
        disabled={!props.hydrated}
        onChange={(e) => setName(e.target.value)}
      />
      <select
        aria-label="Unit"
        className="border-input h-9 rounded-md border bg-transparent px-2"
        value={unit}
        disabled={!props.hydrated}
        onChange={(e) => setUnit(e.target.value as typeof unit)}
      >
        {(["piece", "hour", "meter", "kilogram", "litre"] as const).map((u) => <option key={u} value={u}>{u}</option>)}
      </select>
      <Input
        aria-label="Price"
        placeholder="Price, e.g. 42,50"
        className="w-36"
        value={price}
        disabled={!props.hydrated}
        onChange={(e) => setPrice(e.target.value)}
      />
      <select
        aria-label="VAT"
        className="border-input h-9 rounded-md border bg-transparent px-2"
        value={vat}
        disabled={!props.hydrated}
        onChange={(e) => setVat(Number(e.target.value))}
      >
        <option value={210}>21%</option>
        <option value={90}>9%</option>
        <option value={0}>0%</option>
      </select>
      <Button
        type="submit"
        size="sm"
        disabled={!props.hydrated || sku.trim() === "" || name.trim() === "" || price === ""}
      >
        Add product
      </Button>
      {problem === undefined ? null : <p className="w-full text-sm" role="alert">{problem}</p>}
    </form>
  )
}

const field = (cents: number | undefined, kind: "price" | "vat" | "active" | "name", value: unknown) =>
  kind === "price" ? euro(cents ?? 0) : kind === "vat" ? `${Number(value) / 10}%` : String(value)

/**
 * "Change the price list by asking": an instruction becomes PROPOSALS, each shown as before -> after, and nothing
 * changes until a person applies one. Refusals are the tools' own reasons (a price not in the instruction, an
 * unknown SKU), so the person knows exactly what was not done.
 */
function PriceListChanges(props: {
  readonly hydrated: boolean
  readonly explain: (exit: Exit.Exit<unknown, unknown>) => string
}) {
  const changes = useAtomValue(changesAtom)
  const propose = useAtomSet(proposeChangesAtom, { mode: "promiseExit" })
  const apply = useAtomSet(applyChangeAtom, { mode: "promiseExit" })
  const reject = useAtomSet(rejectChangeAtom, { mode: "promiseExit" })
  const [instruction, setInstruction] = useState("")
  const [busy, setBusy] = useState(false)
  const [refusals, setRefusals] = useState<ReadonlyArray<string>>([])
  const [note, setNote] = useState<string | undefined>(undefined)

  const decide = async (
    changeId: string,
    action: (
      args: { payload: { changeId: string }; reactivityKeys: Array<string> }
    ) => Promise<Exit.Exit<unknown, unknown>>
  ) => {
    setNote(undefined)
    const exit = await action({ payload: { changeId }, reactivityKeys: [CHANGES_KEY, PRODUCTS_KEY] })
    if (Exit.isFailure(exit)) setNote(props.explain(exit))
  }

  const pending = changes._tag === "Success" ? changes.value.filter((change) => change.status === "pending") : []
  const FIELDS = [["name", "name"], ["unitPrice", "price"], ["vat", "vat"], ["active", "active"]] as const

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change the price list by asking</CardTitle>
        <CardDescription>
          E.g. "raise SV-350 to 199 and stop offering OLD-1". You get proposals to approve; nothing changes until you
          apply one.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
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
            } else setNote(props.explain(exit))
            setBusy(false)
          }}
        >
          <Input
            aria-label="Price list instruction"
            value={instruction}
            maxLength={1000}
            disabled={!props.hydrated}
            onChange={(event) => setInstruction(event.target.value)}
          />
          <Button type="submit" disabled={!props.hydrated || busy || instruction.trim() === ""}>
            {busy ? "Working…" : "Propose"}
          </Button>
        </form>
        {refusals.length === 0 ?
          null :
          (
            <ul className="list-disc pl-5 text-amber-700 dark:text-amber-400" aria-label="Not proposed">
              {refusals.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          )}
        {note === undefined ? null : <p role="alert">{note}</p>}
        {pending.map((change) => (
          <div key={change.id} className="rounded-md border p-3" data-testid="proposal">
            <div className="mb-2 font-medium">
              {change.kind === "create_product" ? "New product" : "Change"} {change.sku}
            </div>
            <table className="mb-2 w-full">
              <tbody>
                {FIELDS.filter(([key]) => change.before === null || change.before[key] !== change.after[key]).map(
                  ([key, kind]) => (
                    <tr key={key}>
                      <td className="text-muted-foreground w-24">{kind}</td>
                      <td className="tabular-nums">
                        {change.before === null ? "" : `${field(change.before.unitPrice, kind, change.before[key])} → `}
                        <span className="font-medium">{field(change.after.unitPrice, kind, change.after[key])}</span>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
            <div className="flex gap-2">
              <Button size="sm" disabled={!props.hydrated} onClick={() => void decide(change.id, apply)}>Apply</Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!props.hydrated}
                onClick={() => void decide(change.id, reject)}
              >
                Reject
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
