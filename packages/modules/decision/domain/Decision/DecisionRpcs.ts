/**
 * The decision RPC contract: what the reviewer console asks for.
 *
 * Domain types and camelCase, because the only caller ships with the server — see `Identity.rpc.ts` for why
 * that licence is deliberate. Note what `DecisionDetail` includes: for every citation, **the full text of the
 * chunk it cites**. That is not padding. The console highlights the excerpt inside that text using the same
 * `containsVerbatim` rail 2 used, so it must be given the same text the rail checked against — otherwise the
 * highlight could disagree with the decision it is displaying.
 */
import { AuthenticatedRpc } from "@ea/modules/shared/domain/Identity"
import { RetrievalMode } from "@ea/modules/shared/domain/Retrieval"
import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { Citation, DecisionId, DecisionStatus, Outcome } from "./Decision.ts"

/** One row of the queue grid. Deliberately narrow: the grid shows what a reviewer triages by. */
export class QueueItem extends Schema.Class<QueueItem>("QueueItem")({
  decisionId: DecisionId,
  documentId: Schema.String,
  filename: Schema.String,
  outcome: Outcome,
  status: DecisionStatus,
  /** Which rails fired, so the grid can say WHY this needs a human without opening it. */
  railsFired: Schema.Array(Schema.String),
  retrievalMode: RetrievalMode,
  grounded: Schema.Boolean,
  decidedAt: Schema.String
}) {}

/** A citation with the clause text it is checked against. */
export class CitedClause extends Schema.Class<CitedClause>("CitedClause")({
  citation: Citation,
  /**
   * The chunk's stored content — the exact text rail 2 verified the excerpt against.
   *
   * Null when the chunk has since been deleted or re-indexed, which is itself worth showing: a citation whose
   * clause no longer exists is a decision that can no longer be audited the way it was made.
   */
  clauseText: Schema.NullOr(Schema.String)
}) {}

export class DecisionDetail extends Schema.Class<DecisionDetail>("DecisionDetail")({
  decisionId: DecisionId,
  documentId: Schema.String,
  filename: Schema.String,
  outcome: Outcome,
  status: DecisionStatus,
  rationale: Schema.String,
  railsFired: Schema.Array(Schema.String),
  retrievalMode: RetrievalMode,
  grounded: Schema.Boolean,
  model: Schema.String,
  decidedAt: Schema.String,
  citations: Schema.Array(CitedClause)
}) {}

/** What a review did. Mirrors `ReviewOutcome`, so the console can tell a winner from a loser. */
export const ReviewResult = Schema.Literals(["approved", "rejected", "not_pending"])
export type ReviewResult = typeof ReviewResult.Type

export const DecisionRpcs = RpcGroup.make(
  Rpc.make("Decision.queue", {
    payload: { limit: Schema.optional(Schema.Int) },
    success: Schema.Array(QueueItem)
  }),
  Rpc.make("Decision.get", {
    payload: { decisionId: Schema.String },
    success: Schema.NullOr(DecisionDetail)
  }),
  /*
   * Approve and reject are separate methods rather than one taking an outcome.
   *
   * A single `review(outcome)` makes approving and rejecting the same action with a parameter, and they are
   * not: one emits work that spends money and one does not. Separate names mean a mis-wired button is a
   * different method rather than a different string.
   */
  Rpc.make("Decision.approve", {
    payload: { decisionId: Schema.String },
    success: ReviewResult
  }),
  Rpc.make("Decision.reject", {
    payload: { decisionId: Schema.String },
    success: ReviewResult
  })
).middleware(AuthenticatedRpc)
