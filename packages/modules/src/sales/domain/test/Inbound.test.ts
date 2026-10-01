/**
 * The pure half of email → draft quote: which messages are automated, how an address names its token, the reply
 * subject, and — the one that matters — that the envelope sender is the customer's address while an address the
 * model claims from the text still has to be in the text.
 */
import { isAutomated, requestTextOf, tokenOf } from "@ea/modules/sales/domain/Inbound"
import { Product, ProductId } from "@ea/modules/sales/domain/Product"
import { priceQuote, type QuoteReading, replySubject } from "@ea/modules/sales/domain/Quote"
import { Cents, PerMille } from "@ea/modules/shared/domain/Money"
import { describe, expect, it } from "vitest"

const CATALOGUE = [
  new Product({
    id: ProductId.make("p1"),
    sku: "SV-350",
    name: "Overdrukventiel 350 bar",
    unit: "piece",
    unitPrice: Cents.make(18_900),
    vat: PerMille.make(210),
    active: true
  })
]
const REQUEST = "Graag 2 overdrukventielen 350 bar. Groet, Piet"
const reading = (email: string | null): QuoteReading => ({
  customer_name: null,
  customer_email: email,
  items: [{ request_text: "2 overdrukventielen 350 bar", quantity_text: "2", sku: "SV-350" }]
})

describe("isAutomated", () => {
  it.each(
    [
      [{ autoSubmitted: "auto-replied", precedence: null }, true],
      [{ autoSubmitted: "auto-generated", precedence: null }, true],
      [{ autoSubmitted: "no", precedence: null }, false],
      [{ autoSubmitted: null, precedence: "bulk" }, true],
      [{ autoSubmitted: null, precedence: "list" }, true],
      [{ autoSubmitted: null, precedence: null }, false]
    ] as const
  )("%o → %s", (headers, expected) => {
    expect(isAutomated(headers)).toBe(expected)
  })
})

describe("addresses and subjects", () => {
  it("takes the token from the local part, case-insensitively", () => {
    expect(tokenOf("Ab12CD34ef@offerte.example.nl")).toBe("ab12cd34ef")
  })

  it("puts the subject in front of the body, where customers often write the request", () => {
    expect(requestTextOf("Offerte kleppen", "Graag 2 stuks.")).toBe("Onderwerp: Offerte kleppen\n\nGraag 2 stuks.")
    expect(requestTextOf(null, "Graag 2 stuks.")).toBe("Graag 2 stuks.")
  })

  it("replies with Re: once, keeping a Dutch or German reply prefix as it is", () => {
    expect(replySubject("Offerte kleppen")).toBe("Re: Offerte kleppen")
    expect(replySubject("Re: Offerte kleppen")).toBe("Re: Offerte kleppen")
    expect(replySubject("Antw: Offerte kleppen")).toBe("Antw: Offerte kleppen")
    expect(replySubject(null)).toBeNull()
  })
})

describe("priceQuote with an email sender", () => {
  it("uses the envelope sender as the customer's address, with no missing-address flag", () => {
    const quote = priceQuote(reading(null), REQUEST, CATALOGUE, { email: "piet@smit.nl", name: "Piet Smit" })
    expect(quote.customerEmail).toBe("piet@smit.nl")
    expect(quote.customerName).toBe("Piet Smit")
    expect(quote.flags.some((flag) => flag.includes("Geen e-mailadres"))).toBe(false)
    expect(quote.lines).toHaveLength(1)
  })

  it("still flags an address the model claims that is not in the text, and replies to the sender anyway", () => {
    const quote = priceQuote(reading("invented@elsewhere.nl"), REQUEST, CATALOGUE, {
      email: "piet@smit.nl",
      name: null
    })
    expect(quote.customerEmail).toBe("piet@smit.nl")
    expect(quote.flags.some((flag) => flag.includes("stond niet in de aanvraag"))).toBe(true)
  })

  it("without a sender, behaves as before: no address, and a flag saying so", () => {
    const quote = priceQuote(reading(null), REQUEST, CATALOGUE)
    expect(quote.customerEmail).toBeNull()
    expect(quote.flags.some((flag) => flag.includes("Geen e-mailadres"))).toBe(true)
  })
})
