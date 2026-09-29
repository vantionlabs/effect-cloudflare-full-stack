/**
 * The decide pipeline, as a workflow of four named activities.
 *
 * `Extract → Retrieve → Decide → Judge`, and the naming is the point: each `Activity.make` name is the
 * memo key, so a redelivered message replays every completed step from Postgres instead of paying for
 * it again. A transient judge failure costs one judge call, not an extraction plus a retrieval plus a
 * decision.
 *
 * **It ends at `pending_review` and emits nothing.** The router exists; the execute branch is wired at
 * build-order step 9, deliberately after the human approval path, so that both paths provably call the
 * same function rather than one being retrofitted to match the other.
 *
 * The idempotency key is **derived, never generated**: `decision:<documentId>:<vertical>`. The same key
 * is the workflow's `executionId` and the row's `decide_key`, so a retry at either layer lands on the
 * same identity — and the UNIQUE constraint short-circuits *before any model call*.
 */
import { applyRails, type Outcome, ProposedDecision } from "@ea/modules/decision/domain/Decision"
import { checkArithmetic, INVOICE, Invoice } from "@ea/modules/decision/domain/Invoice"
import { ExtractDocument } from "@ea/modules/decision/use-cases/Extraction"
import { Ids } from "@ea/modules/shared/domain/Ids"
import { PolicySearch, Retrieval } from "@ea/modules/shared/domain/Retrieval"
import { Db, textArray } from "@ea/modules/shared/tables/Database"
import { Effect, Schema } from "effect"
import { LanguageModel } from "effect/ai"
import { Activity, Workflow } from "effect/workflow"
import { EmitExecute } from "./EmitExecute.ts"

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
 */
const proposePrompt = (options: {
  readonly fields: string
  readonly policy: string
}) =>
  `You decide whether a supplier invoice may be approved, using ONLY the policy clauses below.

Rules:
- Cite the clauses you rely on. Every citation must quote the clause VERBATIM, and must name a clause
  that appears below. A citation to anything else is a fabrication and will be rejected.
- If the clauses below do not settle the question, answer needs_human. That is a correct answer, not a
  failure.
- Do not propose auto_approve unless a clause explicitly permits it for this case.

POLICY CLAUSES:
${options.policy}

EXTRACTED INVOICE FIELDS:
${options.fields}`

export const DecideDocumentWorkflow = Workflow.make("DecideDocument", {
  payload: DecidePayload,
  success: DecideResult,
  error: Schema.Never,
  // The execution id derives from the work, so the memo and the row's decide_key agree by construction.
  idempotencyKey: (payload) => decideKey(payload.documentId, payload.vertical)
})

export const DecideDocumentLayer = DecideDocumentWorkflow.toLayer(
  Effect.fnUntraced(function*(payload) {
    const db = yield* Db
    const ids = yield* Ids
    // The PORT, not policy's use case: decision asks for applicable clauses and does not know
    // that the answer comes from pgvector, a Dutch tsvector index and RRF fused in one query.
    const policy = yield* PolicySearch

    /*
     * The short circuit, before any activity runs.
     *
     * A redelivered message finds the existing decision and returns it. This is cheaper than the memo
     * and strictly earlier: the memo saves re-running a step, this saves entering the workflow at all.
     */
    const existing = yield* Effect.orDie(
      db.scoped((sql, orgId) =>
        sql<{ id: string; outcome: Outcome; rails_fired: ReadonlyArray<string>; retrieval_mode: string }>`
        select id, outcome, rails_fired, retrieval_mode from decisions
         where organization_id = ${orgId}
           and decide_key = ${decideKey(payload.documentId, payload.vertical)}
      `
      )
    )
    if (existing.length > 0) {
      const row = existing[0]!
      return new DecideResult({
        decisionId: row.id,
        outcome: row.outcome,
        railsFired: row.rails_fired,
        retrievalMode: row.retrieval_mode,
        replayed: true
      })
    }

    // (1) Extract. The expensive step, and therefore the one the memo is really for.
    /*
     * (1) Extract. The expensive step, and therefore the one the memo is really for.
     *
     * Note what this activity returns: not the raw `ExtractionResult`, but exactly what the rest of the
     * workflow needs. An activity result crosses a serialisation boundary into JSONB, so its schema has
     * to be encodable — and building `retrievalQuery` **inside** the activity, where the typed invoice
     * is still in hand, means nothing downstream has to reach into an `unknown`. It also means the
     * query is memoised, so a replay retrieves with the same one.
     */
    const extraction = yield* Activity.make({
      name: "Extract",
      success: Schema.Struct({
        fields: Schema.Unknown,
        checksPassed: Schema.Boolean,
        unverified: Schema.Array(Schema.String),
        arithmeticFailures: Schema.Array(Schema.String),
        retrievalQuery: Schema.String
      }),
      execute: Effect.map(
        Effect.orDie(
          ExtractDocument({
            documentText: payload.documentText,
            schema: Invoice,
            objectName: INVOICE,
            checkArithmetic
          })
        ),
        (result) => ({
          fields: result.data,
          checksPassed: result.checksPassed,
          unverified: result.verification.unverified,
          arithmeticFailures: result.arithmetic.failures,
          retrievalQuery: [
            result.data.supplier?.value,
            result.data.total_incl_vat?.value,
            "goedkeuring factuur betaling"
          ].filter((part): part is string => typeof part === "string").join(" ")
        })
      )
    })

    // (2) Retrieve. Cheap, but memoised too — a replay must see the SAME clauses, or the decision
    // would be justified against a corpus that has since changed underneath it.
    const retrieval = yield* Activity.make({
      name: "Retrieve",
      success: Retrieval,
      execute: policy.search({ query: extraction.retrievalQuery })
    })

    // (3) Decide. The model proposes; it does not decide.
    const proposal = yield* Activity.make({
      name: "Decide",
      success: ProposedDecision,
      execute: Effect.map(
        Effect.orDie(
          LanguageModel.generateObject({
            prompt: proposePrompt({
              fields: JSON.stringify(extraction.fields, null, 2),
              policy: retrieval.chunks
                .map((chunk) => `[${chunk.chunk_id}] ${chunk.clause_ref ?? ""}\n${chunk.content}`)
                .join("\n\n")
            }),
            schema: ProposedDecision,
            objectName: "ProposedDecision"
          })
        ),
        (response) => response.value
      )
    })

    /*
     * Rail 3's authority, read from the rules table.
     *
     * At most one armed rule per organization per vertical, enforced by a partial unique index — docket
     * allowed several and silently took the newest, so "which rule authorised this" had no single answer.
     * Absent means not armed, which is the correct default for a product that authorises payments.
     */
    const rules = yield* Effect.orDie(db.scoped((sql, orgId) =>
      sql<{ id: string }>`
        select id from rules
         where organization_id = ${orgId} and vertical = ${payload.vertical} and armed
      `
    ))
    const armed = rules.length > 0

    /*
     * (4) The rails. NOT an activity, and that is deliberate.
     *
     * An activity is memoised, and a memoised rail would mean a decision could be replayed past a rail
     * that has since been tightened. The rails are pure and free, so they run every time — and
     * `applyRails` is the only way to obtain the branded value the write below accepts.
     */
    const railed = applyRails({
      proposal,
      grounded: extraction.checksPassed,
      chunkContent: new Map(retrieval.chunks.map((chunk) => [chunk.chunk_id, chunk.content])),
      autoApproveArmed: armed,
      retrievalMode: retrieval.mode
    })

    const decisionId = yield* ids.next
    const status = railed.outcome === "auto_approve" ? "auto_approved" : "pending_review"

    // A database failure here is not in the workflow's error channel and a caller could do nothing with
    // it: the decision either got written or it did not, and a defect is what makes the queue retry.
    yield* Effect.orDie(db.scoped((sql, orgId) =>
      Effect.gen(function*() {
        yield* sql`
          insert into decisions (
            id, organization_id, document_id, vertical, decide_key, outcome, status, rationale,
            rails_fired, retrieval_mode, grounded, model
          ) values (
            ${decisionId}, ${orgId}, ${payload.documentId}, ${payload.vertical},
            ${decideKey(payload.documentId, payload.vertical)}, ${railed.outcome}, ${status},
            ${railed.rationale}, ${textArray(sql, railed.railsFired)}, ${railed.retrievalMode},
            ${extraction.checksPassed}, 'scripted'
          )
        `
        for (const [ordinal, citation] of railed.citations.entries()) {
          yield* sql`
            insert into decision_citations (id, organization_id, decision_id, chunk_id, clause_ref, excerpt, ordinal)
            values (
              ${yield* ids.next}, ${orgId}, ${decisionId}, ${citation.chunk_id},
              ${citation.clause_ref}, ${citation.excerpt}, ${ordinal}
            )
          `
        }
      })
    ))

    /*
     * The auto-approve branch, calling the SAME function the human path calls.
     *
     * This is the architectural claim the whole design turns on, and it is wired LAST on purpose: the human
     * path was built first, so this branch had to conform to it rather than the reverse. `dep:check` asserts
     * exactly one `EmitExecute` call site, and a test asserts an auto-approved execution row is identical to
     * a human-approved one but for `approved_by`.
     */
    if (railed.outcome === "auto_approve") {
      yield* Effect.orDie(EmitExecute({ decisionId, action: "dry_run" }))
    }

    return new DecideResult({
      decisionId,
      outcome: railed.outcome,
      railsFired: railed.railsFired,
      retrievalMode: railed.retrievalMode,
      replayed: false
    })
  })
)
