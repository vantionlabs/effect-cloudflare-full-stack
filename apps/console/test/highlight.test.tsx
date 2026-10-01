/**
 * The highlighter must agree with the rail.
 *
 * This is the test the console exists to have. Rail 2 decided whether a citation verified, using
 * `containsVerbatim`; the highlighter locates that same excerpt for the reviewer. If the two matched by
 * different rules, the screen would show a highlight on a span the rail rejected — or no highlight on one it
 * accepted — and would be quietly contradicting the decision it is displaying.
 *
 * So the property under test is not "highlighting works". It is **agreement**: for every input, the
 * highlighter finds a span exactly when `containsVerbatim` returns true.
 */
import { containsVerbatim } from "@ea/modules/shared/domain/Verbatim"
import { describe, expect, it } from "vitest"
import { locate } from "../src/features/queue/components/highlight.tsx"

const CLAUSE = "Facturen boven EUR 5.000 vereisen twee goedkeuringen\n  van de inkoopafdeling."

describe("the highlighter agrees with the rail", () => {
  const cases: ReadonlyArray<{ readonly label: string; readonly excerpt: string }> = [
    { label: "an exact quote", excerpt: "vereisen twee goedkeuringen" },
    { label: "a re-wrapped quote", excerpt: "twee goedkeuringen van de inkoopafdeling" },
    { label: "a re-cased quote", excerpt: "FACTUREN BOVEN EUR 5.000" },
    { label: "a quote with collapsed whitespace", excerpt: "goedkeuringen   van    de inkoopafdeling" },
    { label: "an altered amount", excerpt: "Facturen boven EUR 6.000" },
    { label: "an altered separator", excerpt: "Facturen boven EUR 5,000" },
    { label: "a fabricated quote", excerpt: "vereisen drie goedkeuringen" },
    { label: "an empty quote", excerpt: "" }
  ]

  for (const { excerpt, label } of cases) {
    it(`${label}: highlights exactly when the rail verifies`, () => {
      const railVerifies = containsVerbatim(excerpt, CLAUSE)
      const highlightFound = locate(CLAUSE, excerpt) !== null

      expect(
        highlightFound,
        `rail says ${railVerifies}, highlighter says ${highlightFound} — the screen would contradict the decision`
      ).toBe(railVerifies)
    })
  }
})

describe("the located span", () => {
  it("points at the original text, not the normalised form", () => {
    /*
     * The real work. Matching happens on normalised text — whitespace collapsed, case folded — but the
     * highlight must be drawn on the ORIGINAL, newlines and all. An `indexOf` on the original would fail on
     * a re-wrapped quote, which is exactly what normalisation exists to allow.
     */
    const span = locate(CLAUSE, "twee goedkeuringen van de inkoopafdeling")
    expect(span).not.toBeNull()
    const [start, end] = span!
    const sliced = CLAUSE.slice(start, end)

    // The slice spans the newline and the indentation, because that is what the document contains.
    expect(sliced).toContain("\n")
    // And it is still the same text under the rail's own normalisation.
    expect(containsVerbatim(sliced, CLAUSE)).toBe(true)
  })

  it("does not over-select", () => {
    const span = locate(CLAUSE, "twee goedkeuringen")!
    expect(CLAUSE.slice(span[0], span[1])).toBe("twee goedkeuringen")
  })
})
