/**
 * The labelled invoice set: deterministic, model-free, generated backwards from the label.
 *
 * Ported from docket's `evals/factories.py`, whose three arguments all still hold:
 *
 * 1. **No model calls.** Templates plus seeded randomness, so rebuilding the set costs nothing. An
 *    eval set that is expensive to rebuild is one nobody rebuilds.
 * 2. **Generated backwards.** Pick the outcome and the reason first, then synthesise a document that
 *    has that property. Labelling documents after the fact needs a human and produces exactly the
 *    labels the labeller happened to think of; generating from the label makes ground truth free and
 *    the distribution controllable.
 * 3. **Weighted, not evenly split.** Real intake is mostly clean. An even split would tune the
 *    pipeline for a world that does not exist.
 *
 * Two things are different here, both forced by this codebase rather than chosen:
 *
 * **The documents are Dutch.** docket's fixtures are English, and `retrieve_policy` hardcodes
 * `to_tsvector('dutch', …)`. Porting English text into a Dutch-stemmed index would measure a
 * configuration mismatch and report it as a retrieval score. Amounts therefore use Dutch convention
 * (`1.234,56`), which `parseMoney` reads unambiguously because both separators are present — and
 * which is the formatting a naive `Number()` would silently turn into `1.234`.
 *
 * **Spans are exact substrings of the rendered markdown.** `verifySpans` checks every
 * `source_span` against the document, so a generator that wrote a prettier span than it printed
 * would fail rail 1 on every case and the whole harness would measure nothing but its own bug.
 * `asExtractionFields` and `render` therefore share one formatter, and a test asserts the property.
 */
import type { Invoice } from "@ea/modules/decision/domain/Invoice"

// --- the labelled scenarios ---------------------------------------------

type Expected = "auto_approve" | "route_for_approval" | "reject" | "needs_human"

export interface Scenario {
  readonly key: string
  /** The outcome a human actually reached. */
  readonly expected: Expected
  /** What a correct decision must have considered. Makes a regression legible: "the currency rule
   * stopped being retrieved" is actionable, "recall fell to 0.8" is not. */
  readonly dimensions: ReadonlyArray<string>
  readonly note: string
  /** Relative frequency. Real intake is mostly clean. */
  readonly weight: number
}

export const SCENARIOS: ReadonlyArray<Scenario> = [
  {
    key: "clean_under_threshold",
    expected: "auto_approve",
    dimensions: ["amount", "supplier", "purchase_order"],
    note: "Goedgekeurde leverancier, inkooporder aanwezig, onder de grens van de budgethouder.",
    weight: 8
  },
  {
    key: "over_threshold",
    expected: "route_for_approval",
    dimensions: ["amount"],
    note: "Boven de grens van de budgethouder, dus iemand senior moet tekenen.",
    weight: 5
  },
  {
    key: "no_purchase_order",
    expected: "route_for_approval",
    dimensions: ["purchase_order", "amount"],
    note: "Boven EUR 500 zonder inkooporder: autorisatie achteraf.",
    weight: 4
  },
  {
    key: "unknown_supplier",
    expected: "route_for_approval",
    dimensions: ["supplier"],
    note: "Niet op de lijst van goedgekeurde leveranciers, dus de inkoopafdeling controleert eerst.",
    weight: 3
  },
  {
    key: "arithmetic_wrong",
    expected: "reject",
    dimensions: ["vat"],
    note: "De regels tellen niet op tot het subtotaal. Terug naar de leverancier.",
    weight: 2
  },
  {
    key: "illegal_vat_rate",
    expected: "reject",
    dimensions: ["vat"],
    note: "Het afgeleide BTW-tarief is geen wettelijk Nederlands tarief.",
    weight: 1
  },
  {
    key: "foreign_currency",
    expected: "route_for_approval",
    dimensions: ["currency", "amount"],
    note: "Niet in euro: Finance rekent om en legt de koers vast.",
    weight: 2
  },
  {
    key: "short_payment_terms",
    expected: "route_for_approval",
    dimensions: ["payment_terms", "supplier"],
    note: "Betaling binnen veertien dagen geëist, wat het beleid een fraude-indicator noemt.",
    weight: 2
  },
  {
    key: "duplicate_invoice",
    expected: "reject",
    dimensions: ["duplicate"],
    note: "Zelfde leverancier en factuurnummer als een al betaalde factuur.",
    weight: 2
  },
  {
    key: "over_board_threshold",
    expected: "route_for_approval",
    dimensions: ["amount"],
    note: "Boven EUR 25.000: twee bestuursleden, genotuleerd.",
    weight: 1
  }
]

/** The scenarios where auto-approval would be money out of the door. The gate is zero of these. */
export const MUST_NOT_AUTO_APPROVE: ReadonlySet<string> = new Set(
  SCENARIOS.filter((scenario) => scenario.expected !== "auto_approve").map((scenario) => scenario.key)
)

// --- vocabulary ---------------------------------------------------------

/** Matches `evals/fixtures/corpus/goedgekeurde-leveranciers.md`, article for article. */
export const APPROVED_SUPPLIERS: ReadonlyArray<string> = [
  "Contoso Cleaning Services BV",
  "Fabrikam Office Supplies BV",
  "Northwind IT Partners BV",
  "Tailspin Facilities BV",
  "Woodgrove Legal BV",
  "Proseware Print & Signage BV",
  "Adventure Works Catering BV",
  "Coho Vineyard Hospitality BV",
  "Lucerne Publishing BV",
  "Trey Research BV"
]

/** Deliberately absent from the corpus, so retrieval has to find the clause and not the name. */
const UNKNOWN_SUPPLIERS: ReadonlyArray<string> = [
  "Litware Consulting Group BV",
  "Wingtip Toys Trading BV",
  "Fourth Coffee Supplies BV",
  "Graphic Design Institute BV",
  "Blue Yonder Logistics BV"
]

const COST_CENTRES = ["FAC-01", "OPS-04", "IT-01", "STR-02", "MKT-03", "HR-02", "FIN-01"]

/** Description and unit price in cents. Integer minor units from here to the rendered page. */
const LINE_ITEMS: ReadonlyArray<readonly [string, number]> = [
  ["Schoonmaak kantoor, per maand", 62_000],
  ["Aanvulling verbruiksartikelen", 2_250],
  ["Zit-statafel, in hoogte verstelbaar", 48_000],
  ["Bureaustoel, ergonomisch", 26_500],
  ["Monitorarm, dubbel", 9_500],
  ["Onderhoudsbezoek klimaatinstallatie", 41_000],
  ["Set vervangingsfilters", 4_800],
  ["Cloudhosting, per kwartaal", 840_000],
  ["Begeleiding strategiesessie", 175_000],
  ["Juridische beoordeling, per uur", 29_500],
  ["Gedrukte brochures, per 500", 34_000],
  ["Catering, per persoon", 2_850],
  ["Laptop, ontwikkelaarsspecificatie", 215_000],
  ["Beveiligingsaudit, vaste prijs", 1_450_000],
  ["Vertaling, per 1000 woorden", 11_500]
]

const CITIES: ReadonlyArray<readonly [string, string]> = [
  ["Amsterdam", "1017 CB"],
  ["Rotterdam", "3012 NJ"],
  ["Utrecht", "3511 ED"],
  ["Eindhoven", "5628 DH"],
  ["Groningen", "9711 AB"],
  ["Den Haag", "2511 CV"]
]

const MONTHS = [
  "januari",
  "februari",
  "maart",
  "april",
  "mei",
  "juni",
  "juli",
  "augustus",
  "september",
  "oktober",
  "november",
  "december"
]

/** Legal Dutch VAT rates, in per-mille, matching `CheckArithmetic`'s set. */
const LEGAL_VAT = [210, 90, 0] as const

// --- determinism --------------------------------------------------------

/**
 * mulberry32. A named algorithm with an explicit 32-bit state, for a specific reason.
 *
 * docket's note is worth carrying over verbatim in spirit: Python's `hash()` on a str is salted per
 * process, so using it made the "deterministic" corpus differ on every run and quietly invalidated
 * any comparison between eval passes. JavaScript has the same trap in a different shape — there is no
 * seedable `Math.random`, so reaching for it would produce a set that cannot be compared to
 * yesterday's. The seed is a parameter and the same seed gives the same corpus, always.
 */
const mulberry32 = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Rng {
  readonly int: (min: number, max: number) => number
  readonly pick: <A>(items: ReadonlyArray<A>) => A
  readonly sample: <A>(items: ReadonlyArray<A>, count: number) => ReadonlyArray<A>
}

const rngFrom = (seed: number): Rng => {
  const next = mulberry32(seed)
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1))
  return {
    int,
    pick: (items) => items[int(0, items.length - 1)]!,
    sample: <A>(items: ReadonlyArray<A>, count: number) => {
      const pool = [...items]
      const out: Array<A> = []
      for (let taken = 0; taken < count && pool.length > 0; taken++) {
        out.push(pool.splice(int(0, pool.length - 1), 1)[0]!)
      }
      return out
    }
  }
}

// --- formatting ---------------------------------------------------------

/**
 * Dutch convention, from integer cents. THE one formatter.
 *
 * Shared by `render` and `asExtractionFields` on purpose: a span is only a span if it occurs in the
 * document, and two formatters would drift the moment one of them gained a thousands separator.
 */
export const euros = (cents: number): string => {
  const negative = cents < 0
  const absolute = Math.abs(cents)
  const whole = Math.trunc(absolute / 100)
  const fraction = String(absolute % 100).padStart(2, "0")
  // Manual grouping rather than toLocaleString: the ICU data available to a runtime is not something
  // a fixture's byte-for-byte stability should depend on.
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  return `${negative ? "-" : ""}${grouped},${fraction}`
}

const dutchDate = (date: Date): string => `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]!} ${date.getUTCFullYear()}`

const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * 86_400_000)

// --- the generated invoice ----------------------------------------------

interface Line {
  readonly description: string
  readonly quantity: number
  readonly unitPriceCents: number
  readonly amountCents: number
}

export interface GeneratedInvoice {
  readonly filename: string
  readonly markdown: string
  readonly scenario: Scenario
  readonly supplier: string
  readonly invoiceNumber: string
  readonly currency: "EUR" | "USD" | "GBP"
  readonly totalInclVatCents: number
  readonly vatCents: number
  readonly poNumber: string | null
  readonly costCentre: string
  readonly paymentDays: number
  /** Set when this invoice deliberately repeats an earlier supplier + number pair. */
  readonly duplicateOf: string | null
  readonly lines: ReadonlyArray<Line>
  /**
   * The extraction JSON the pipeline would have stored: every field with the span it was read from.
   *
   * Typed as `Invoice` rather than `unknown` so that a change to the vertical's schema breaks this
   * generator at compile time. The generator always knew these values — it wrote them into the
   * markdown — and docket's version dropped them on the way out, which made five thousand stored
   * extractions unreadable and nothing noticed until a replay tried to read them.
   */
  readonly fields: Invoice
}

/** Line items summing EXACTLY to `targetSubtotal`, in cents. */
const buildLines = (rng: Rng, targetSubtotalCents: number): ReadonlyArray<Line> => {
  const picks = rng.sample(LINE_ITEMS, rng.int(1, 3))
  const lines: Array<Line> = []
  let remaining = targetSubtotalCents

  picks.forEach(([description, unitPriceCents], index) => {
    const isLast = index === picks.length - 1
    if (isLast) {
      // The remainder becomes a quantity of one, so the lines add up exactly. A "clean" invoice that
      // failed the arithmetic check would be testing the wrong thing.
      lines.push({ description, quantity: 1, unitPriceCents: remaining, amountCents: remaining })
      return
    }
    const quantity = rng.int(1, 6)
    const amount = unitPriceCents * quantity
    if (amount >= remaining) return
    remaining -= amount
    lines.push({ description, quantity, unitPriceCents, amountCents: amount })
  })

  return lines.length > 0
    ? lines
    : [{
      description: "Geleverde diensten",
      quantity: 1,
      unitPriceCents: targetSubtotalCents,
      amountCents: targetSubtotalCents
    }]
}

/**
 * The issue date, fixed rather than derived from today.
 *
 * A fixture set whose dates move with the clock is one whose "within 14 days" cases stop meaning
 * what they meant, and whose stored extractions cannot be compared across runs.
 */
const ISSUE_DATE = new Date(Date.UTC(2026, 1, 12))

const render = (invoice: Omit<GeneratedInvoice, "markdown" | "fields">, city: readonly [string, string]): string => {
  const subtotal = invoice.totalInclVatCents - invoice.vatCents
  const issued = ISSUE_DATE
  const due = addDays(issued, invoice.paymentDays)
  const rows = invoice.lines
    .map((line) =>
      `| ${line.description} | ${line.quantity} | ${euros(line.unitPriceCents)} | ${euros(line.amountCents)} |`
    )
    .join("\n")

  return `# FACTUUR

**${invoice.supplier}**
${city[0]}, ${city[1]}
BTW-nummer: NL${8000 + (invoice.invoiceNumber.length * 137) % 1999}.45.678.B01

Aan: Nederland BV, Herengracht 500, 1017 CB Amsterdam

| | |
|---|---|
| Factuurnummer | ${invoice.invoiceNumber} |
| Factuurdatum | ${dutchDate(issued)} |
| Vervaldatum | ${dutchDate(due)} |
${invoice.poNumber === null ? "" : `| Inkoopordernummer | ${invoice.poNumber} |\n`}\
| Kostenplaats | ${invoice.costCentre} |
| Betalingstermijn | ${invoice.paymentDays} dagen netto |

## Regels

| Omschrijving | Aantal | Stuksprijs | Bedrag |
|---|---|---|---|
${rows}

Subtotaal exclusief BTW: ${invoice.currency} ${euros(subtotal)}
BTW: ${invoice.currency} ${euros(invoice.vatCents)}
**Totaal inclusief BTW: ${invoice.currency} ${euros(invoice.totalInclVatCents)}**

Te betalen op NL02 ABNA 0123 4567 89 binnen ${invoice.paymentDays} dagen.
`
}

const field = (value: string) => ({ value, source_span: value })

const asExtractionFields = (invoice: Omit<GeneratedInvoice, "markdown" | "fields">): Invoice => {
  const base = {
    currency: field(invoice.currency),
    supplier: field(invoice.supplier),
    invoice_number: field(invoice.invoiceNumber),
    issued_on: field(dutchDate(ISSUE_DATE)),
    total_incl_vat: field(euros(invoice.totalInclVatCents)),
    vat_amount: field(euros(invoice.vatCents)),
    due_on: field(dutchDate(addDays(ISSUE_DATE, invoice.paymentDays))),
    cost_centre: field(invoice.costCentre),
    line_items: invoice.lines.map((line) => ({
      description: field(line.description),
      quantity: field(String(line.quantity)),
      unit_price: field(euros(line.unitPriceCents)),
      amount: field(euros(line.amountCents))
    }))
  }
  // Omitted rather than null when absent: the schema says `Schema.optional`, and a null would be a
  // different statement — "we looked and there is none" versus "the document does not state it".
  return (invoice.poNumber === null
    ? base
    : { ...base, po_number: field(invoice.poNumber) }) as unknown as Invoice
}

/** VAT for a subtotal at a legal rate, in cents. Integer arithmetic, per-mille in and cents out. */
const vatFor = (subtotalCents: number, perMille: number): number => Math.round((subtotalCents * perMille) / 1000)

const supplierPrefix = (supplier: string) => supplier.split(" ").slice(0, 1).join("").slice(0, 3).toUpperCase()

/**
 * Builds `count` labelled invoices, weighted by scenario.
 *
 * The same seed gives the same set. `count` is the number of DOCUMENTS, so the scenario mix is a
 * property of the weights and not of the count — which is what lets a 99-case run and a 300-case run
 * be compared.
 */
export const buildInvoices = (count: number, seed = 11): ReadonlyArray<GeneratedInvoice> => {
  const rng = rngFrom(seed)
  const bag = SCENARIOS.flatMap((scenario) => Array.from({ length: scenario.weight }, () => scenario))
  const out: Array<GeneratedInvoice> = []
  /** Supplier + number pairs already issued, so a duplicate case can point at a real earlier one. */
  const issued: Array<{ readonly supplier: string; readonly number: string }> = []

  for (let index = 0; index < count; index++) {
    const scenario = bag[index % bag.length]!
    const city = rng.pick(CITIES)

    let supplier = rng.pick(APPROVED_SUPPLIERS)
    let currency: "EUR" | "USD" | "GBP" = "EUR"
    let paymentDays = 30
    let poNumber: string | null = `PO-2026-${String(1000 + index).slice(-4)}`
    let duplicateOf: string | null = null
    let vatPerMille: number = rng.pick(LEGAL_VAT)
    /** The band the amount is drawn from, in cents, chosen by the scenario. */
    let subtotalCents = rng.int(20_000, 90_000)
    let breakLineSum = false

    switch (scenario.key) {
      case "clean_under_threshold":
        // Under EUR 1.000 INCLUDING VAT, so it is inside the budget holder's authority even at 21%.
        subtotalCents = rng.int(20_000, 78_000)
        vatPerMille = 210
        break
      case "over_threshold":
        subtotalCents = rng.int(150_000, 2_000_000)
        break
      case "no_purchase_order":
        subtotalCents = rng.int(60_000, 400_000)
        poNumber = null
        break
      case "unknown_supplier":
        supplier = rng.pick(UNKNOWN_SUPPLIERS)
        subtotalCents = rng.int(30_000, 300_000)
        break
      case "arithmetic_wrong":
        subtotalCents = rng.int(50_000, 500_000)
        breakLineSum = true
        break
      case "illegal_vat_rate":
        subtotalCents = rng.int(50_000, 500_000)
        // 13% — a plausible-looking rate that is not one of the three legal ones.
        vatPerMille = 130
        break
      case "foreign_currency":
        currency = "USD"
        subtotalCents = rng.int(100_000, 900_000)
        break
      case "short_payment_terms":
        paymentDays = rng.int(5, 12)
        subtotalCents = rng.int(80_000, 600_000)
        break
      case "duplicate_invoice":
        subtotalCents = rng.int(40_000, 300_000)
        break
      case "over_board_threshold":
        subtotalCents = rng.int(3_000_000, 12_000_000)
        break
    }

    const vatCents = vatFor(subtotalCents, vatPerMille)
    let invoiceNumber = `${supplierPrefix(supplier)}-2026-${String(4000 + index)}`

    if (scenario.key === "duplicate_invoice" && issued.length > 0) {
      const earlier = issued[rng.int(0, issued.length - 1)]!
      supplier = earlier.supplier
      invoiceNumber = earlier.number
      duplicateOf = earlier.number
    }

    let lines = buildLines(rng, subtotalCents)
    if (breakLineSum) {
      // Perturb ONE line so the lines no longer sum to the subtotal, and by well over the 2-cent
      // rounding tolerance. Note this also breaks quantity × unit price on that line, which is
      // exactly what a doctored invoice looks like.
      const first = lines[0]!
      lines = [{ ...first, amountCents: first.amountCents + rng.int(5_000, 40_000) }, ...lines.slice(1)]
    }

    const core = {
      filename: `${String(index).padStart(4, "0")}-${scenario.key}.md`,
      scenario,
      supplier,
      invoiceNumber,
      currency,
      totalInclVatCents: subtotalCents + vatCents,
      vatCents,
      poNumber,
      costCentre: rng.pick(COST_CENTRES),
      paymentDays,
      duplicateOf,
      lines
    }

    out.push({ ...core, markdown: render(core, city), fields: asExtractionFields(core) })
    if (duplicateOf === null) issued.push({ supplier, number: invoiceNumber })
  }

  return out
}
