/**
 * The rails, and the one property that must hold for every input.
 *
 * The exhaustive block at the bottom is the important one. It is **exhaustive rather than
 * property-based on purpose**: the input space that matters is 4 outcomes × 2 grounded × 2 armed × 4
 * retrieval modes × 3 citation shapes = 384 cases, which is small enough to enumerate completely. A
 * generator would sample it; enumeration proves it. That is a better deal than fast-check here, and it
 * needs no dependency.
 */
import { applyRails, Citation, type Outcome, ProposedDecision, severity } from "@ea/modules/decision/domain/Decision"
import type { RetrievalMode } from "@ea/modules/policy/domain/Chunk"
import { describe, expect, it } from "vitest"

const CHUNK = "chunk_1"
const POLICY_TEXT = "Facturen boven EUR 5.000 vereisen twee goedkeuringen van de inkoopafdeling."
const chunkContent = new Map([[CHUNK, POLICY_TEXT]])

const citation = (excerpt: string, chunkId = CHUNK) =>
  new Citation({ chunk_id: chunkId, clause_ref: "Artikel 3", excerpt })

const propose = (outcome: Outcome, citations: ReadonlyArray<Citation> = [citation(POLICY_TEXT)]) =>
  new ProposedDecision({ outcome, citations, rationale: "Boven de grens van EUR 5.000." })

const rails = (options: {
  readonly outcome: Outcome
  readonly grounded?: boolean
  readonly armed?: boolean
  readonly mode?: RetrievalMode
  readonly citations?: ReadonlyArray<Citation>
}) =>
  applyRails({
    proposal: propose(options.outcome, options.citations),
    grounded: options.grounded ?? true,
    chunkContent,
    autoApproveArmed: options.armed ?? true,
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

describe("rail 1 — grounding", () => {
  it("escalates to needs_human when a span did not verify", () => {
    const result = rails({ outcome: "auto_approve", grounded: false })
    expect(result.outcome).toBe("needs_human")
    expect(result.railsFired[0]).toContain("grounding")
  })

  it("escalates even a route_for_approval, because the facts are not established", () => {
    expect(rails({ outcome: "route_for_approval", grounded: false }).outcome).toBe("needs_human")
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
    const result = rails({ outcome: "auto_approve", armed: false })
    expect(result.outcome).toBe("route_for_approval")
    expect(result.railsFired[0]).toContain("no armed auto-approve rule")
  })

  it("does not block route_for_approval, which needs no standing authority", () => {
    expect(rails({ outcome: "route_for_approval", armed: false }).outcome).toBe("route_for_approval")
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

    let checked = 0
    for (const outcome of outcomes) {
      for (const grounded of [true, false]) {
        for (const armed of [true, false]) {
          for (const mode of modes) {
            for (const shape of citationShapes) {
              const result = rails({ outcome, grounded, armed, mode, citations: shape.citations })
              checked++
              expect(
                severity[result.outcome],
                `${outcome} + grounded=${grounded} armed=${armed} mode=${mode} citations=${shape.label} ` +
                  `became ${result.outcome}, which is LESS severe`
              ).toBeGreaterThanOrEqual(severity[outcome])
            }
          }
        }
      }
    }
    // Guards the guard: a loop that silently iterated nothing would pass.
    expect(checked).toBe(4 * 2 * 2 * 4 * 3)
  })

  it("always records why it fired, whenever it changed the outcome", () => {
    // An escalation with no reason is unauditable — the reviewer is told to look at something without
    // being told what.
    for (const grounded of [true, false]) {
      for (const armed of [true, false]) {
        const result = rails({ outcome: "auto_approve", grounded, armed })
        if (result.outcome !== "auto_approve") expect(result.railsFired.length).toBeGreaterThan(0)
      }
    }
  })
})
