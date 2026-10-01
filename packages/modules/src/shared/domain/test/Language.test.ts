import { answerLanguageRule, detectLanguage } from "@ea/modules/shared/domain/Language"
import { describe, expect, it } from "vitest"

describe("detectLanguage", () => {
  it.each(
    [
      ["Hoeveel geld komt er de komende maand binnen?", "Dutch"],
      ["Hoeveel offertes hebben we deze maand verstuurd?", "Dutch"],
      ["Wat is de aandraaimoment van de hydraulische koppeling?", "Dutch"],
      ["How much cash comes in next month?", "English"],
      ["How many quotes did we send this month?", "English"]
    ] as const
  )("%s → %s", (question, language) => {
    expect(detectLanguage(question)).toBe(language)
  })

  it("says nothing when there is no signal", () => {
    expect(detectLanguage("SKU-100 €12,50")).toBeUndefined()
    expect(answerLanguageRule("SKU-100 €12,50")).toBe("")
  })

  it("names the language in the rule", () => {
    expect(answerLanguageRule("Hoeveel facturen staan open?")).toContain("written in Dutch")
  })
})
