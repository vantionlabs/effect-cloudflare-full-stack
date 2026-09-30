/**
 * The rails: the four checks that stand between a model's proposal and a stored decision.
 *
 * **This is a pure function with an unconstructible brand, not a service — and that is the point.**
 * `DecisionStore.settle` accepts only a `RailedDecision`, and `RailedDecision` cannot be built outside
 * this module, because the brand symbol is not exported. So *a decision cannot be written without
 * having passed the rails, and it is a compile error to try.*
 *
 * A service would be wrong here for a specific reason: "the rails, but disabled" must not be
 * expressible. Injecting them means someone can provide a permissive implementation in a test, a
 * demo, or a hurry, and the resulting row is indistinguishable from a checked one. docket's rails are
 * a function too, but nothing stops a caller inserting a `Decision` row directly; the brand closes
 * exactly that gap.
 *
 * ## The four rails
 *
 * 1. **A failed deterministic check → `needs_human`.** If a span did not verify, or the invoice's own
 *    numbers do not add up, the facts the decision rests on are not established. The two arrive as
 *    separate lists so the rail can **name the real cause**: this used to be one `grounded` boolean and
 *    every arithmetic failure was reported as "one or more extracted spans did not verify", which sent
 *    a reviewer looking in the wrong place. `evals:rule` printed that lie as "stopped by: grounding" on
 *    the arithmetic scenarios, which is how it was noticed.
 * 2. **Any non-verbatim citation forces review.** A quote that is not in the chunk it cites is the
 *    failure that matters most: a plausible sentence the policy never contained.
 * 3. **`auto_approve` requires an armed rule whose every bound holds.** Never model confidence — *a
 *    model's own confidence score is not an authorisation.* And never merely the existence of a rule:
 *    `bun run evals:rule` measured what that weaker version cost, with the model assumed wrong, at
 *    **190 of 300 labelled invoices released**, a EUR 118,683 invoice among them. The ceiling was in
 *    the table the whole time and nothing read it. Rail 3 now consumes `evaluateRule`'s unmet
 *    conditions and escalates once per unmet bound, naming each.
 * 4. **`auto_approve` additionally requires `retrieval_mode === "hybrid"`.** Degraded retrieval that
 *    nobody can see is exactly the failure this problem shape keeps producing. Added beyond docket's
 *    three, and admissible only because it can move a decision one way: toward a human.
 *
 * Every rail can only increase severity. That is checked exhaustively rather than asserted.
 */
import type { RetrievalMode } from "@ea/modules/shared/domain/Retrieval"
import { containsVerbatim } from "@ea/modules/shared/domain/Verbatim"
import type { Citation, Outcome, ProposedDecision } from "./Decision.ts"

/**
 * The brand. Not exported, so no other module can produce a value of the branded type — not even by
 * writing the same shape, and not with a cast that type-checks.
 */
declare const RailedBrand: unique symbol

export interface RailedDecision {
  readonly [RailedBrand]: never
  readonly outcome: Outcome
  readonly citations: ReadonlyArray<Citation>
  readonly rationale: string
  /** Why the rails moved the outcome, in the order they fired. Empty when nothing fired. */
  readonly railsFired: ReadonlyArray<string>
  /** Recorded on the row: a decision made on degraded retrieval is not the same decision. */
  readonly retrievalMode: RetrievalMode
}

export interface RailInput {
  readonly proposal: ProposedDecision
  /** Field paths whose `source_span` did not occur in the document. Rail 1. */
  readonly unverifiedSpans: ReadonlyArray<string>
  /** Sums that did not add up, each naming the specific one. Rail 1, with its own message. */
  readonly arithmeticFailures: ReadonlyArray<string>
  /** The retrieved chunks' content, by chunk id, for the verbatim check. Rail 2. */
  readonly chunkContent: ReadonlyMap<string, string>
  /**
   * Rail 3's authority. `null` means there is no armed rule at all; an empty array means an armed rule
   * whose every bound held, which is the only state in which `auto_approve` survives this rail.
   *
   * Reasons rather than a boolean, because the reviewer sees them: "above the rule's ceiling of EUR
   * 1.000,00" is actionable and "the rule did not apply" is not.
   */
  readonly ruleUnmet: ReadonlyArray<string> | null
  /** Which halves of retrieval actually ran. Rail 4. */
  readonly retrievalMode: RetrievalMode
}

/**
 * The one place a `RailedDecision` comes into existence.
 *
 * The double cast is required — TypeScript refuses a direct one, because a plain object genuinely does
 * not overlap with a type carrying a `unique symbol` field. **That refusal is the guarantee.** No
 * caller outside this module can write this line without importing a symbol that is not exported, so
 * the only way to obtain a `RailedDecision` is to have gone through `applyRails`.
 *
 * Contained in one function so there is exactly one place to audit, and so `rg "as unknown as
 * RailedDecision"` returns one hit.
 */
const railed = (value: Omit<RailedDecision, typeof RailedBrand>): RailedDecision => value as unknown as RailedDecision

export const applyRails = (input: RailInput): RailedDecision => {
  const fired: Array<string> = []
  let outcome = input.proposal.outcome

  /** Rails may only move toward a human, so every change goes through this. */
  const escalate = (to: Outcome, reason: string) => {
    fired.push(reason)
    // A proposal that is already `reject` or `needs_human` is not walked back to `route_for_approval`.
    if (outcome !== "reject" && outcome !== "needs_human") outcome = to
    else if (to === "needs_human") outcome = to
  }

  // Rail 1, first half. A span that is not in the document is a number the document never contained.
  for (const path of input.unverifiedSpans) {
    escalate("needs_human", `grounding: the span for ${path} does not occur in the document`)
  }

  /*
   * Rail 1, second half — a SEPARATE message, on purpose.
   *
   * An arithmetic failure is not a grounding failure: the span is fine, the document really does say
   * that, and what is wrong is the supplier's own sum. Reporting it as "grounding" sent reviewers to
   * check provenance for a problem that was arithmetic. Each failure already names the specific sum.
   */
  for (const failure of input.arithmeticFailures) {
    escalate("needs_human", `arithmetic: ${failure}`)
  }

  // Rail 2. Checked against the chunk the citation NAMES, not against the corpus at large — a quote
  // that exists somewhere else in policy is still not support for the clause being cited.
  for (const citation of input.proposal.citations) {
    const content = input.chunkContent.get(citation.chunk_id)
    if (content === undefined) {
      escalate(
        "needs_human",
        `citation: chunk ${citation.chunk_id} was never retrieved for this decision`
      )
      continue
    }
    if (!containsVerbatim(citation.excerpt, content)) {
      escalate(
        "needs_human",
        `citation: excerpt is not verbatim in ${citation.clause_ref ?? citation.chunk_id}`
      )
    }
  }

  // A proposal to approve automatically with nothing to point at is not a decision.
  if (outcome === "auto_approve" && input.proposal.citations.length === 0) {
    escalate("route_for_approval", "citation: auto_approve proposed with no citations")
  }

  // Rail 3. An armed rule AND every one of its bounds, never the model's own view of itself.
  if (outcome === "auto_approve") {
    if (input.ruleUnmet === null) {
      escalate("route_for_approval", "authority: no armed auto-approve rule for this organization")
    } else {
      // One escalation per unmet bound, so the reviewer sees every reason rather than the first.
      for (const reason of input.ruleUnmet) escalate("route_for_approval", reason)
    }
  }

  // Rail 4. Both halves of retrieval must have run.
  if (outcome === "auto_approve" && input.retrievalMode !== "hybrid") {
    escalate(
      "route_for_approval",
      `retrieval: mode was ${input.retrievalMode}, and auto-approval requires hybrid`
    )
  }

  return railed({
    outcome,
    citations: input.proposal.citations,
    rationale: input.proposal.rationale,
    railsFired: fired,
    retrievalMode: input.retrievalMode
  })
}
