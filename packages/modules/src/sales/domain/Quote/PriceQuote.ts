/**
 * Turns the model's reading of a request into priced quote lines — in CODE, from the price list.
 *
 * Every number on a quote is computed here: the quantity parsed from the request's own words, the price taken
 * from the catalogue, the line total and VAT in integer cents. The model contributed only pointers into the
 * request and a choice of SKU, and each is checked:
 *
 * - an item whose `request_text` is not verbatim in the request is dropped — the model invented a requirement;
 * - a quantity that is not verbatim in that item's own words, or is ambiguous (`1.234`), is not priced;
 * - a SKU that is null, not in the catalogue, or inactive is not priced;
 * - a customer email not written in the request is not used, so a quote can never be sent to an address the
 *   model made up.
 *
 * Each of those becomes a FLAG, in words a person can act on, rather than a silent omission — the draft is for a
 * person to approve, and what they most need is to know what the machine could not do.
 */
import { Cents, lineAmount, Milli, parseScaledInteger, type PerMille } from "@ea/modules/shared/domain/Money"
import { containsVerbatim } from "@ea/modules/shared/domain/Verbatim"
import { Result } from "effect"
import type { Product } from "../Product/Product.ts"
import type { QuoteReading } from "./QuoteReading.ts"

export interface PricedLine {
  readonly productId: string
  readonly sku: string
  readonly description: string
  /** The request's own words this line answers — kept so a reviewer can see why the line exists. */
  readonly requestText: string
  readonly quantity: Milli
  readonly unit: string
  readonly unitPrice: Cents
  readonly vat: PerMille
  /** Quantity × unit price, excluding VAT. */
  readonly lineTotal: Cents
}

export interface PricedQuote {
  readonly customerName: string | null
  readonly customerEmail: string | null
  readonly lines: ReadonlyArray<PricedLine>
  readonly subtotal: Cents
  readonly vatTotal: Cents
  readonly total: Cents
  /** What a person must check before approving. Empty means the machine priced everything it was asked for. */
  readonly flags: ReadonlyArray<string>
}

/** VAT on one line, rounded half-up to the cent per line — what a printed quote shows and adds up. */
const vatOn = (amount: Cents, rate: PerMille): Cents => Cents.make(Math.round((amount * rate) / 1000))

const QUANTITY_DECIMALS = 3

export const priceQuote = (
  reading: QuoteReading,
  request: string,
  catalogue: ReadonlyArray<Product>
): PricedQuote => {
  const flags: Array<string> = []
  const bySku = new Map(catalogue.map((product) => [product.sku.toLowerCase(), product]))
  const lines: Array<PricedLine> = []

  for (const item of reading.items) {
    if (!containsVerbatim(item.request_text, request)) {
      flags.push(`Regel weggelaten die niet in de aanvraag staat: "${item.request_text}".`)
      continue
    }
    if (!containsVerbatim(item.quantity_text, item.request_text)) {
      flags.push(`Geen aantal gevonden in "${item.request_text}" — voeg de regel zelf toe.`)
      continue
    }
    const quantity = parseScaledInteger(item.quantity_text, QUANTITY_DECIMALS)
    if (Result.isFailure(quantity) || quantity.success <= 0) {
      flags.push(`Het aantal "${item.quantity_text}" in "${item.request_text}" is niet eenduidig — controleer het.`)
      continue
    }
    if (item.sku === null) {
      flags.push(`Niets in de prijslijst past bij "${item.request_text}".`)
      continue
    }
    const product = bySku.get(item.sku.toLowerCase())
    if (product === undefined) {
      flags.push(`"${item.request_text}" werd gekoppeld aan ${item.sku}, maar dat staat niet in de prijslijst.`)
      continue
    }
    if (!product.active) {
      flags.push(`"${item.request_text}" past bij ${product.sku}, maar dat wordt niet meer aangeboden.`)
      continue
    }
    const amount = Milli.make(quantity.success)
    lines.push({
      productId: product.id,
      sku: product.sku,
      description: product.name,
      requestText: item.request_text,
      quantity: amount,
      unit: product.unit,
      unitPrice: product.unitPrice,
      vat: product.vat,
      lineTotal: lineAmount(amount, product.unitPrice)
    })
  }

  const customerName = reading.customer_name !== null && containsVerbatim(reading.customer_name, request)
    ? reading.customer_name
    : null
  const customerEmail = reading.customer_email !== null && containsVerbatim(reading.customer_email, request)
    ? reading.customer_email.trim()
    : null
  if (reading.customer_email !== null && customerEmail === null) {
    flags.push("Het opgegeven e-mailadres van de klant stond niet in de aanvraag en is dus niet gebruikt.")
  }
  if (customerEmail === null) {
    flags.push("Geen e-mailadres van de klant — vul het in voordat de offerte verstuurd kan worden.")
  }
  if (lines.length === 0) flags.push("Niets in de aanvraag kon geprijsd worden.")

  const subtotal = Cents.make(lines.reduce((sum, line) => sum + line.lineTotal, 0))
  const vatTotal = Cents.make(lines.reduce((sum, line) => sum + vatOn(line.lineTotal, line.vat), 0))
  return {
    customerName,
    customerEmail,
    lines,
    subtotal,
    vatTotal,
    total: Cents.make(subtotal + vatTotal),
    flags
  }
}
