/**
 * `priceQuote`: every number on a quote comes from code and the price list, and everything the model claims about
 * the request is checked against the request. Each test is a way a model could get a quote wrong — and what the
 * person approving it is told instead.
 */
import { Product, ProductId } from "@ea/modules/sales/domain/Product"
import { priceQuote, type QuoteReading } from "@ea/modules/sales/domain/Quote"
import { Cents, PerMille } from "@ea/modules/shared/domain/Money"
import { describe, expect, it } from "vitest"

const product = (sku: string, name: string, cents: number, vat: number, active = true) =>
  new Product({
    id: ProductId.make(`p_${sku}`),
    sku,
    name,
    unit: "piece",
    unitPrice: Cents.make(cents),
    vat: PerMille.make(vat),
    active
  })

const CATALOGUE = [
  product("HS-12", "Hydraulic hose 12 mm, per piece", 4_250, 210),
  product("SV-350", "Pressure relief valve 350 bar", 18_900, 210),
  product("OLD-1", "Discontinued seal kit", 1_000, 210, false)
]

const REQUEST = "Hallo, graag een offerte voor 3 stuks hydrauliekslang 12mm en 1 overdrukventiel 350 bar. " +
  "Groet, Jan de Vries (jan@devries-transport.nl)"

const reading = (items: QuoteReading["items"], email: string | null = "jan@devries-transport.nl"): QuoteReading => ({
  customer_name: "Jan de Vries",
  customer_email: email,
  items
})

describe("priceQuote", () => {
  it("prices from the catalogue and computes every total in integer cents", () => {
    const quote = priceQuote(
      reading([
        { request_text: "3 stuks hydrauliekslang 12mm", quantity_text: "3", sku: "HS-12" },
        { request_text: "1 overdrukventiel 350 bar", quantity_text: "1", sku: "SV-350" }
      ]),
      REQUEST,
      CATALOGUE
    )
    expect(quote.lines.map((line) => [line.sku, line.quantity, line.lineTotal])).toEqual([
      ["HS-12", 3000, 12_750],
      ["SV-350", 1000, 18_900]
    ])
    expect(quote.subtotal).toBe(31_650)
    expect(quote.vatTotal).toBe(Math.round(12_750 * 0.21) + Math.round(18_900 * 0.21))
    expect(quote.total).toBe(quote.subtotal + quote.vatTotal)
    expect(quote.flags).toEqual([])
    expect(quote.customerEmail).toBe("jan@devries-transport.nl")
  })

  it("drops an item the request never asked for", () => {
    const quote = priceQuote(
      reading([{ request_text: "10 drukvaten", quantity_text: "10", sku: "SV-350" }]),
      REQUEST,
      CATALOGUE
    )
    expect(quote.lines).toEqual([])
    expect(quote.flags[0]).toContain("niet in de aanvraag staat")
  })

  it("will not price a quantity the item's own words do not state", () => {
    // The model claims 30, but the request says 3.
    const quote = priceQuote(
      reading([{ request_text: "3 stuks hydrauliekslang 12mm", quantity_text: "30", sku: "HS-12" }]),
      REQUEST,
      CATALOGUE
    )
    expect(quote.lines).toEqual([])
    expect(quote.flags[0]).toContain("Geen aantal gevonden")
  })

  it("refuses a SKU that is not in the price list, rather than inventing a product", () => {
    const quote = priceQuote(
      reading([{ request_text: "1 overdrukventiel 350 bar", quantity_text: "1", sku: "SV-999" }]),
      REQUEST,
      CATALOGUE
    )
    expect(quote.lines).toEqual([])
    expect(quote.flags[0]).toContain("staat niet in de prijslijst")
  })

  it("does not offer a discontinued product", () => {
    const quote = priceQuote(
      reading([{ request_text: "3 stuks hydrauliekslang 12mm", quantity_text: "3", sku: "OLD-1" }]),
      REQUEST,
      CATALOGUE
    )
    expect(quote.flags[0]).toContain("niet meer aangeboden")
  })

  it("flags a request with nothing in the catalogue for a person to handle", () => {
    const quote = priceQuote(
      reading([{ request_text: "3 stuks hydrauliekslang 12mm", quantity_text: "3", sku: null }]),
      REQUEST,
      CATALOGUE
    )
    expect(quote.flags).toContain("Niets in de aanvraag kon geprijsd worden.")
  })

  it("never uses a customer email that is not in the request", () => {
    const quote = priceQuote(
      reading([{ request_text: "1 overdrukventiel 350 bar", quantity_text: "1", sku: "SV-350" }], "boss@elsewhere.com"),
      REQUEST,
      CATALOGUE
    )
    expect(quote.customerEmail).toBeNull()
    expect(quote.flags).toContain(
      "Het opgegeven e-mailadres van de klant stond niet in de aanvraag en is dus niet gebruikt."
    )
  })

  it("rounds fractional quantities half-up to the cent, per line", () => {
    const request = "2,5 uur montage"
    const labour = new Product({
      id: ProductId.make("p_LAB"),
      sku: "LAB",
      name: "Labour",
      unit: "hour",
      unitPrice: Cents.make(6_499),
      vat: PerMille.make(210),
      active: true
    })
    const quote = priceQuote(
      {
        customer_name: null,
        customer_email: null,
        items: [{ request_text: request, quantity_text: "2,5", sku: "LAB" }]
      },
      request,
      [labour]
    )
    // 2.5 × 64.99 = 162.475 -> 162.48; VAT 21% of 162.48 = 34.1208 -> 34.12.
    expect(quote.lines[0]!.lineTotal).toBe(16_248)
    expect(quote.vatTotal).toBe(3_412)
  })
})
