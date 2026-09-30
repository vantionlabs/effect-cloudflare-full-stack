/**
 * The decide pipeline's contract: what it is asked, what it answers, and the prompt it asks the model.
 *
 * Its own file so that `DecideSteps.ts` and both orchestrators can import these without a cycle —
 * the steps need `DecideResult` and `decideKey`, and the orchestrators need the payload. A cycle between two
 * schema files does not fail as a cycle: it fails at import time with
 * `Cannot read properties of undefined (reading 'ast')` pointing at the class being defined rather than the
 * import that was not ready. `AskAnswer.ts` records the same lesson.
 *
 * The idempotency key is **derived, never generated**: `decision:<documentId>:<vertical>`. The same key is
 * the workflow's id and the row's `decide_key`, so a retry at either layer lands on the same identity — and
 * the UNIQUE constraint short-circuits *before any model call*.
 */
import { Schema } from "effect"

/** What the decide workflow is asked to do. */
export const DecidePayload = Schema.Struct({
  documentId: Schema.String,
  /** The parsed document text. Passed in rather than re-read: the parser version defines the
   * verbatim contract, so the bytes a span is checked against must be the ones extraction saw. */
  documentText: Schema.String,
  vertical: Schema.String
})

export class DecideResult extends Schema.Class<DecideResult>("DecideResult")({
  decisionId: Schema.String,
  outcome: Schema.Literals(["auto_approve", "route_for_approval", "reject", "needs_human"]),
  railsFired: Schema.Array(Schema.String),
  retrievalMode: Schema.String,
  /** True when this call replayed an existing decision rather than making one. */
  replayed: Schema.Boolean
}) {}

/** The derived key. One function, so the workflow id and the row's decide_key cannot diverge. */
export const decideKey = (documentId: string, vertical: string) => `decision:${documentId}:${vertical}`

/**
 * The model's proposal step.
 *
 * `citations` before `rationale` comes from `ProposedDecision`, where the ordering is measured — see
 * that file. The prompt asks for a decision from retrieved policy and nothing else; it is not asked
 * for a confidence score, because there is nowhere to put one.
 *
 * **The outcome glossary is there because the model was being asked an unanswerable question.** The policy
 * authorises a *person* — "the budget holder may approve up to EUR 1.000" — and never authorises a machine,
 * so a model told "do not propose auto_approve unless a clause explicitly permits it" correctly declines
 * every time. `auto_approve` was reached on 0 of 12 cases, which is the same hole docket's baseline had
 * ("gate never exercised"). The fix is to say what the outcome means in this system: the model reports
 * whether policy is satisfied, and rail 3's stored rule decides automation. The rule can only ever refuse.
 *
 * **"ALWAYS cite, including needs_human" is there because the first real eval run produced 12 of 12
 * `needs_human` with zero citations.** The old prompt told the model that refusing was a correct answer
 * and never said a refusal still has to point at something — so it refused, articulately, at nothing. An
 * unauditable refusal is the failure this product exists to prevent, arriving dressed as caution: every
 * aggregate looks cautious and responsible while not one decision can be checked by a human.
 */
export const proposePrompt = (options: {
  readonly fields: string
  readonly policy: string
}) =>
  `You decide whether a supplier invoice may be approved, using ONLY the policy clauses below.

Rules:
- ALWAYS cite. Cite the clauses you relied on, whichever outcome you choose — including needs_human.
  A refusal with no citation cannot be audited, and an uncited decision is rejected whatever it says.
- Every citation must quote the clause VERBATIM and must name a clause that appears below. A citation to
  anything else is a fabrication and will be rejected.
- Each clause is shown with its full heading. Headings matter: a corpus may contain a SUPERSEDED policy
  retained for audit, with the same article numbers and different amounts. Apply the clause that is in
  force and say which one you applied.
- If the clauses below do not settle the question, answer needs_human and cite the clause that you could
  not satisfy. That is a correct answer, not a failure — but it still has to point at something.

What the four outcomes mean HERE. Read this before choosing one:
- auto_approve: the invoice satisfies every clause that applies to it, and no clause requires a judgement
  you had to make. You are NOT deciding that it will be paid without a human — a stored authorisation
  rule you cannot see decides that afterwards, and it can only refuse, never permit. So a clause saying
  "the budget holder may approve up to EUR 1.000" is a clause that is SATISFIED by a EUR 800 invoice; it
  is not a reason to withhold auto_approve because the approver would be a person.
- route_for_approval: the invoice complies, but a clause requires a named person or a second signature.
- reject: a clause forbids paying it as presented — the totals do not add up, the VAT rate is not legal,
  or it duplicates an invoice already paid.
- needs_human: the clauses do not settle it, or they contradict each other.

POLICY CLAUSES:
${options.policy}

EXTRACTED INVOICE FIELDS:
${options.fields}`

/** The payload as a value, so the steps can name it without importing the schema's module twice. */
export type DecidePayloadValue = typeof DecidePayload.Type
