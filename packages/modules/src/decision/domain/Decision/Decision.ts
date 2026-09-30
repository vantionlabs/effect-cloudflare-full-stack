/**
 * What a decision is, and the closed set of things it can be.
 *
 * **Field order in `ProposedDecision` is measured, not aesthetic.** `citations` is declared **before**
 * `rationale`. A model generating JSON emits keys in schema order, so it must name the clauses it is
 * relying on before it writes prose about them. The other way round, it writes `[7]` mid-paragraph and
 * only afterwards works out what citation 7 was: docket measured that ordering accounting for **25 of
 * 66 grounding failures on a 99-case run**. This is the one ordering claim in the codebase backed by a
 * number rather than by an argument.
 */
import { Schema } from "effect"

export const DecisionId = Schema.String.pipe(Schema.brand("DecisionId"))
export type DecisionId = typeof DecisionId.Type

/**
 * The closed set of outcomes. Adding one is a product decision, not a convenience.
 *
 * `needs_human` and `reject` are both terminal for automation but mean different things: `reject` is a
 * decision we are prepared to defend, `needs_human` is an admission that we are not.
 */
export const Outcome = Schema.Literals([
  "auto_approve",
  "route_for_approval",
  "reject",
  "needs_human"
])
export type Outcome = typeof Outcome.Type

/**
 * How far each outcome is from being automatic.
 *
 * Exists so the rails' central property is *statable*: rails may only ever move a decision toward a
 * human, never away. `applyRails` is tested against this ordering exhaustively.
 */
export const severity: Record<Outcome, number> = {
  auto_approve: 0,
  route_for_approval: 1,
  reject: 2,
  needs_human: 2
}

/** A quote from the policy corpus, with the chunk it came from. */
export class Citation extends Schema.Class<Citation>("Citation")({
  /** Which retrieved chunk. A citation to a chunk that was never retrieved is a fabrication. */
  chunk_id: Schema.String,
  clause_ref: Schema.NullOr(Schema.String),
  /**
   * The verbatim excerpt being relied on.
   *
   * Checked with `containsVerbatim` against the chunk's stored content — the same function the
   * reviewer console highlights with, so the highlight cannot disagree with the rail.
   */
  excerpt: Schema.String
}) {}

/**
 * What the model proposes. **Not** what gets stored — `applyRails` stands between.
 *
 * Note what is absent: any confidence score. A model's own confidence is not an authorisation, so
 * there is nowhere to put one, which is stronger than agreeing not to use it.
 */
export class ProposedDecision extends Schema.Class<ProposedDecision>("ProposedDecision")({
  outcome: Outcome,
  // Before `rationale`, deliberately. See the module docstring for the measurement.
  citations: Schema.Array(Citation),
  rationale: Schema.String
}) {}

export const DecisionStatus = Schema.Literals([
  "pending_review",
  "approved",
  "rejected",
  "auto_approved",
  "needs_attention"
])
export type DecisionStatus = typeof DecisionStatus.Type
