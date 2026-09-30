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
  .middleware(Authenticated)
