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
 * 1. **Failed grounding → `needs_human`.** If the extraction's spans did not verify, the facts the
 *    decision rests on are not established.
 * 2. **Any non-verbatim citation forces review.** A quote that is not in the chunk it cites is the
 *    failure that matters most: a plausible sentence the policy never contained.
 * 3. **`auto_approve` requires an explicitly armed rule.** Never model confidence — *a model's own
 *    confidence score is not an authorisation.*
 * 4. **`auto_approve` additionally requires `retrieval_mode === "hybrid"`.** Degraded retrieval that
 *    nobody can see is exactly the failure this problem shape keeps producing. Added beyond docket's
 *    three, and admissible only because it can move a decision one way: toward a human.
 *
 * Every rail can only increase severity. That is checked exhaustively rather than asserted.
 */
import type { RetrievalMode } from "@ea/modules/shared/domain/Retrieval"
import { containsVerbatim } from "@ea/modules/shared/domain/Verbatim"
import type { Citation, Outcome, ProposedDecision } from "./Decision.model.ts"

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
  /** Whether every extracted field's span verified. Rail 1. */
  readonly grounded: boolean
  /** The retrieved chunks' content, by chunk id, for the verbatim check. Rail 2. */
  readonly chunkContent: ReadonlyMap<string, string>
  /** Whether an armed auto-approve rule exists for this org and vertical. Rail 3. */
  readonly autoApproveArmed: boolean
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

  // Rail 1. The facts are not established, so there is nothing to decide on.
  if (!input.grounded) {
    escalate("needs_human", "grounding: one or more extracted spans did not verify")
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

  // Rail 3. An explicit stored rule, never the model's own view of itself.
  if (outcome === "auto_approve" && !input.autoApproveArmed) {
    escalate("route_for_approval", "authority: no armed auto-approve rule for this organization")
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
