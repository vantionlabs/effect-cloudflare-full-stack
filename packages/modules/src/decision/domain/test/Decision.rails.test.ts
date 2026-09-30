/**
 * The rails, and the one property that must hold for every input.
 *
 * The exhaustive block at the bottom is the important one. It is **exhaustive rather than
 * property-based on purpose**: the input space that matters is 4 outcomes × 2 check states × 3 rule
 * states × 4 retrieval modes × 3 citation shapes = 288 cases, which is small enough to enumerate
 * completely. A generator would sample it; enumeration proves it. That is a better deal than fast-check
 * here, and it needs no dependency.
 *
 * The rule axis has **three** states rather than two, and that is the substance of a change made after
 * `bun run evals:rule` measured rail 3: no rule at all, an armed rule whose bounds all held, and an
 * armed rule with an unmet bound. The middle and the last were one boolean before, so "armed" meant
 * "approved" and a stored ceiling was never consulted.
 */
import { applyRails, Citation, type Outcome, ProposedDecision, severity } from "@ea/modules/decision/domain/Decision"
import type { RetrievalMode } from "@ea/modules/shared/domain/Retrieval"
import { describe, expect, it } from "vitest"

const CHUNK = "chunk_1"
const POLICY_TEXT = "Facturen boven EUR 5.000 vereisen twee goedkeuringen van de inkoopafdeling."
const chunkContent = new Map([[CHUNK, POLICY_TEXT]])

const citation = (excerpt: string, chunkId = CHUNK) =>
  new Citation({ chunk_id: chunkId, clause_ref: "Artikel 3", excerpt })

const propose = (outcome: Outcome, citations: ReadonlyArray<Citation> = [citation(POLICY_TEXT)]) =>
  new ProposedDecision({ outcome, citations, rationale: "Boven de grens van EUR 5.000." })

/** The three states rail 3 distinguishes, named so a test reads as the situation it describes. */
type RuleState = "none" | "met" | "unmet"

const ruleUnmetFor = (state: RuleState): ReadonlyArray<string> | null =>
  state === "none" ? null : state === "met" ? [] : ["amount: EUR 8.000,00 is above the rule's ceiling of EUR 1.000,00"]

const rails = (options: {
  readonly outcome: Outcome
  readonly spans?: ReadonlyArray<string>
  readonly arithmetic?: ReadonlyArray<string>
  readonly rule?: RuleState
  readonly mode?: RetrievalMode
  readonly citations?: ReadonlyArray<Citation>
}) =>
  applyRails({
    proposal: propose(options.outcome, options.citations),
    unverifiedSpans: options.spans ?? [],
    arithmeticFailures: options.arithmetic ?? [],
    chunkContent,
    ruleUnmet: ruleUnmetFor(options.rule ?? "met"),
    retrievalMode: options.mode ?? "hybrid"
  })

describe("the happy path exists", () => {
  it("lets a clean, armed, hybrid auto_approve through unchanged", () => {
    // Worth asserting explicitly: rails that stopped everything would pass every other test here and
    // be worthless. This is the case that proves the gate can open.
    const result = rails({ outcome: "auto_approve" })
    expect(result.outcome).toBe("auto_approve")
    expect(result.railsFired).toEqual([])
  })
})

describe("rail 1 — the deterministic checks", () => {
  it("escalates to needs_human when a span did not verify, naming the field", () => {
    const result = rails({ outcome: "auto_approve", spans: ["total_incl_vat"] })
    expect(result.outcome).toBe("needs_human")
    expect(result.railsFired[0]).toContain("grounding")
    // The path, not just the category: a reviewer needs to know which field to look at.
    expect(result.railsFired[0]).toContain("total_incl_vat")
  })

  it("reports an arithmetic failure as arithmetic, NOT as grounding", () => {
    /*
     * The bug this split fixes. Both checks used to collapse into one `grounded` boolean whose message
     * read "one or more extracted spans did not verify" — so an invoice whose lines did not add up sent
     * the reviewer to check provenance. `evals:rule` printed it as "stopped by: grounding" on the
     * arithmetic scenarios, which is how it was spotted.
     */
    const result = rails({
      outcome: "auto_approve",
      arithmetic: ["line items sum to 4714.83, but total minus VAT is 4395.91"]
    })
    expect(result.outcome).toBe("needs_human")
    expect(result.railsFired[0]).toContain("arithmetic")
    expect(result.railsFired[0]).not.toContain("grounding")
    // And it carries the specific sum through verbatim, because that is what the reviewer acts on.
    expect(result.railsFired[0]).toContain("4714.83")
  })

  it("fires once per failure, so nothing is hidden behind the first one", () => {
    const result = rails({
      outcome: "auto_approve",
      spans: ["supplier", "vat_amount"],
      arithmetic: ["VAT works out to 13.0%, which is not a legal Dutch rate"]
    })
    expect(result.railsFired.length).toBe(3)
  })

  it("escalates even a route_for_approval, because the facts are not established", () => {
    expect(rails({ outcome: "route_for_approval", spans: ["supplier"] }).outcome).toBe("needs_human")
  })
})

describe("rail 2 — citations", () => {
  it("escalates a quote that is not verbatim in the cited chunk", () => {
    const result = rails({ outcome: "auto_approve", citations: [citation("vereisen drie goedkeuringen")] })
    expect(result.outcome).toBe("needs_human")
    expect(result.railsFired[0]).toContain("not verbatim")
  })

  it("escalates a citation to a chunk that was never retrieved", () => {
    // The sharper case. The excerpt might be real policy — just not policy this decision retrieved,
    // which means nobody checked whether it applies.
    const result = rails({ outcome: "auto_approve", citations: [citation(POLICY_TEXT, "chunk_other")] })
    expect(result.outcome).toBe("needs_human")
    expect(result.railsFired[0]).toContain("never retrieved")
  })

  it("accepts a re-wrapped or re-cased quote, which is not an invention", () => {
    const result = rails({
      outcome: "auto_approve",
      citations: [citation("facturen boven eur 5.000\n  vereisen twee goedkeuringen")]
    })
    expect(result.outcome).toBe("auto_approve")
  })

  it("refuses auto_approve with no citations at all", () => {
    const result = rails({ outcome: "auto_approve", citations: [] })
    expect(result.outcome).toBe("route_for_approval")
    expect(result.railsFired[0]).toContain("no citations")
  })
})

describe("rail 3 — authority", () => {
  it("refuses auto_approve without an armed rule", () => {
    // A model's own confidence is not an authorisation, and there is nowhere in ProposedDecision to
    // put one — so this rail is about a stored rule or nothing.
    const result = rails({ outcome: "auto_approve", rule: "none" })
    expect(result.outcome).toBe("route_for_approval")
    expect(result.railsFired[0]).toContain("no armed auto-approve rule")
  })

  it("refuses auto_approve when an armed rule exists but a bound does not hold", () => {
    /*
     * The case that was unrepresentable before, and the one that mattered: `evals:rule` measured 190 of
     * 300 labelled invoices released because rail 3 asked only whether a rule existed while the table
     * stored a ceiling nothing read.
     */
    const result = rails({ outcome: "auto_approve", rule: "unmet" })
    expect(result.outcome).toBe("route_for_approval")
    expect(result.railsFired[0]).toContain("above the rule's ceiling")
  })

  it("passes the unmet reason through verbatim, because the reviewer reads it", () => {
    // "The rule did not apply" is not an answer anybody can act on; the amount and the ceiling are.
    expect(rails({ outcome: "auto_approve", rule: "unmet" }).railsFired[0]).toContain("EUR 1.000,00")
  })

  it("lets auto_approve through when every bound held", () => {
    expect(rails({ outcome: "auto_approve", rule: "met" }).outcome).toBe("auto_approve")
  })

  it("does not block route_for_approval, which needs no standing authority", () => {
    expect(rails({ outcome: "route_for_approval", rule: "none" }).outcome).toBe("route_for_approval")
  })
})

describe("rail 4 — retrieval mode", () => {
  for (const mode of ["lexical", "semantic", "none"] as const) {
    it(`refuses auto_approve on ${mode} retrieval`, () => {
      const result = rails({ outcome: "auto_approve", mode })
      expect(result.outcome).toBe("route_for_approval")
      expect(result.railsFired[0]).toContain("requires hybrid")
    })
  }

  it("records the mode on the decision either way", () => {
    // Recorded rather than merely checked: a decision made on degraded retrieval is not the same
    // decision, and the row has to say which it was.
    expect(rails({ outcome: "route_for_approval", mode: "lexical" }).retrievalMode).toBe("lexical")
  })
})

describe("the central property, exhaustively", () => {
  it("never moves a decision away from a human, for any input", () => {
    const outcomes: ReadonlyArray<Outcome> = [
      "auto_approve",
      "route_for_approval",
      "reject",
      "needs_human"
    ]
    const modes: ReadonlyArray<RetrievalMode> = ["hybrid", "lexical", "semantic", "none"]
    const citationShapes = [
      { label: "verbatim", citations: [citation(POLICY_TEXT)] },
      { label: "fabricated", citations: [citation("iets heel anders")] },
      { label: "none", citations: [] }
    ]

    const ruleStates: ReadonlyArray<RuleState> = ["none", "met", "unmet"]
    let checked = 0
    for (const outcome of outcomes) {
      for (const failing of [false, true]) {
        for (const rule of ruleStates) {
          for (const mode of modes) {
            for (const shape of citationShapes) {
              const result = rails({
                outcome,
                spans: failing ? ["supplier"] : [],
                arithmetic: failing ? ["lines do not sum"] : [],
                rule,
                mode,
                citations: shape.citations
              })
              checked++
              expect(
                severity[result.outcome],
                `${outcome} + failing=${failing} rule=${rule} mode=${mode} citations=${shape.label} ` +
                  `became ${result.outcome}, which is LESS severe`
              ).toBeGreaterThanOrEqual(severity[outcome])
            }
          }
        }
      }
    }
    // Guards the guard: a loop that silently iterated nothing would pass.
    expect(checked).toBe(4 * 2 * 3 * 4 * 3)
  })

  it("always records why it fired, whenever it changed the outcome", () => {
    // An escalation with no reason is unauditable — the reviewer is told to look at something without
    // being told what.
    for (const failing of [false, true]) {
      for (const rule of ["none", "met", "unmet"] as const) {
        const result = rails({ outcome: "auto_approve", spans: failing ? ["supplier"] : [], rule })
        if (result.outcome !== "auto_approve") expect(result.railsFired.length).toBeGreaterThan(0)
      }
    }
  })
})
