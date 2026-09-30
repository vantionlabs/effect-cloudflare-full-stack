/**
 * The public, frozen contract for decisions: the queue and one decision's detail.
 *
 * **The citations are the part that cannot be added later.** A decision's value is that every claim carries a
 * verbatim excerpt somebody can audit a year afterwards, so `excerpt`, `chunk_id` and `clause_ref` are part of
 * v1 rather than an enrichment — a client that shipped without them would have no way to show why a decision
 * was made, which is the product.
 *
 * Wire types are derived from the domain types with `wireFrom`, which projects the published fields and renames
 * them to snake_case in the encoded form only. The committed OpenAPI snapshot is what stops a domain rename
 * reaching a client unnoticed; see `shared/domain/Wire`.
 */
import { Authenticated } from "@ea/domain/Identity"
import { pageOf, pickFields, wire, wireFrom } from "@ea/modules/shared/domain/Wire"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiError, HttpApiGroup } from "effect/http-api"
import { CitedClause, DecisionDetail, QueueItem } from "./DecisionRpcs.ts"

/** A queue row: enough to triage without opening it, which is why the rails are here. */
export const DecisionSummaryV1 = wireFrom(QueueItem, [
  "decisionId",
  "documentId",
  "filename",
  "outcome",
  "status",
  "railsFired",
  "retrievalMode",
  "grounded",
  "decidedAt"
])

/**
 * A citation, with the clause text it was checked against.
 *
 * `citation`'s own fields are already snake_case in the domain (`chunk_id`, `clause_ref`, `excerpt`) — that was
 * a decision about the model's JSON, and it happens to mean the nested shape needs no rename.
 */
export const CitedClauseV1 = wireFrom(CitedClause, ["citation", "clauseText"])

/**
 * One decision in full.
 *
 * Built with `wire` and a spread rather than `wireFrom`, because `citations` has to be SUBSTITUTED: the domain
 * field holds `CitedClause`, whose `clauseText` would otherwise be published in camelCase.
 */
export const DecisionDetailV1 = wire({
  ...pickFields(DecisionDetail.fields, [
    "decisionId",
    "documentId",
    "filename",
    "outcome",
    "status",
    "rationale",
    "railsFired",
    "retrievalMode",
    "grounded",
    "model",
    "decidedAt"
  ]),
  citations: Schema.Array(CitedClauseV1)
})

/**
 * Returned when a decision id names nothing in the caller's organization.
 *
 * A typed 404 rather than the framework's default, for the same reason `UnsupportedDocumentV1` is typed: the
 * refusal is part of the contract a client branches on. It says nothing about WHY — a decision belonging to
 * another organization is indistinguishable from one that does not exist, which is the point.
 */
export class DecisionNotFoundV1 extends Schema.Error<DecisionNotFoundV1>(
  "DecisionNotFoundV1"
)({ _tag: Schema.tag("DecisionNotFoundV1"), decision_id: Schema.String }, { httpApiStatus: 404 }) {}

/**
 * 409, because the decision exists and is no longer open.
 *
 * The compare-and-swap that settles a decision matches only a `pending_review` row, so a second caller — a
 * second tab, a retried request, another client — finds nothing to update. That is a conflict with the current
 * state and not a failure: exactly one caller wins, which is the property the queue depends on.
 */
export class DecisionNotPendingV1 extends Schema.Error<DecisionNotPendingV1>(
  "DecisionNotPendingV1"
)({ _tag: Schema.tag("DecisionNotPendingV1"), decision_id: Schema.String }, { httpApiStatus: 409 }) {}

/** What a review did. `not_pending` never reaches a client — it becomes the 409 above. */
export const ReviewResultV1 = wire({ decisionId: Schema.String, result: Schema.Literals(["approved", "rejected"]) })

export const DecisionGroup = HttpApiGroup.make("decisions")
  .add(
    HttpApiEndpoint.get("list", "/decisions", {
      query: {
        /**
         * The whole point of the collection: it is how a client polls for the outcome of a document it
         * uploaded, which `POST /intakes` answers 202 to. Named `intake_id` because the 202 returns
         * `intake_id`, and a client should not have to translate between the two.
         */
        intake_id: Schema.optional(Schema.String),
        cursor: Schema.optional(Schema.String),
        limit: Schema.optional(Schema.FiniteFromString)
      },
      success: pageOf(DecisionSummaryV1),
      // A cursor this server did not issue. Declared, because an undeclared error becomes a 500 and the
      // handler's type stops matching — which is how this was caught rather than shipped.
      error: HttpApiError.BadRequest
    })
  )
  .add(
    HttpApiEndpoint.get("get", "/decisions/:decisionId", {
      // `params`, not `path`. `HttpApiEndpoint` names path parameters `params`; an unknown key here makes
      // TypeScript fall back to the no-content overload, so the error blames `success` instead.
      params: { decisionId: Schema.String },
      success: DecisionDetailV1,
      error: DecisionNotFoundV1
    })
  )
  .add(
    /*
     * `POST` to an action sub-resource, not `PATCH /decisions/{id}` with a status.
     *
     * Approving is not a field assignment. It is a compare-and-swap that emits an execution event, and the single
     * emit call site is asserted by a `grep -c` test — the mechanical half of the claim that a human approval and
     * an automatic one take the same path. Modelling it as a status write would invite a client to think it could
     * set any status, and would hide that something happens as a result.
     */
    HttpApiEndpoint.post("approve", "/decisions/:decisionId/approve", {
      params: { decisionId: Schema.String },
      success: ReviewResultV1,
      error: [DecisionNotFoundV1, DecisionNotPendingV1]
    })
  )
  .add(
    HttpApiEndpoint.post("reject", "/decisions/:decisionId/reject", {
      params: { decisionId: Schema.String },
      success: ReviewResultV1,
      error: [DecisionNotFoundV1, DecisionNotPendingV1]
    })
  )
  .middleware(Authenticated)
