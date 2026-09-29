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
import { checkArithmetic, INVOICE, Invoice, invoiceRuleFacts } from "@ea/modules/decision/domain/Invoice"
import { AutoApproveRule, evaluateRule } from "@ea/modules/decision/domain/Rule"
import { Telemetry } from "@ea/modules/decision/domain/Telemetry"
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
const proposePrompt = (options: {
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
    const telemetry = yield* Telemetry
    const startedAt = yield* Effect.clockWith((clock) => clock.currentTimeMillis)
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
      db.scopedForOrg((sql, orgId) =>
        sql<{ id: string; outcome: Outcome; rails_fired: ReadonlyArray<string>; retrieval_mode: string }>`
        select id, outcome, rails_fired, retrieval_mode from decisions
         where organization_id = ${orgId}
           and decide_key = ${decideKey(payload.documentId, payload.vertical)}
      `
      )
    )
    if (existing.length > 0) {
      const row = existing[0]!
      /*
       * A replay is REPORTED, flagged as such.
       *
       * Silently returning here would make every rate drift as redeliveries accumulate: the denominator
       * would count messages while the numerator counted decisions. `replayed` is a field so a query can
       * exclude them, rather than this path being invisible.
       */
      yield* telemetry.decision({
        vertical: payload.vertical,
        outcome: row.outcome,
        railsFired: row.rails_fired,
        retrievalMode: row.retrieval_mode as Retrieval["mode"],
        grounded: true,
        citations: 0,
        inputTokens: undefined,
        outputTokens: undefined,
        durationMillis: 0,
        replayed: true
      })
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
              /*
               * The HEADING is included, not just `clause_ref`, and that is load-bearing on a real corpus.
               *
               * A client's corpus contains a superseded policy retained for audit, with the SAME article
               * numbers and different thresholds — so two retrieved chunks both carry `clause_ref` of
               * "Artikel 3" and the model has no way to tell which is in force. The headings differ
               * ("Artikel 3 Goedkeuringsgrenzen" versus "… (2024 tot 2025)"), so showing them is the whole
               * fix. Found by running the eval against the corpus with its distractors, where the model was
               * being asked to choose between two contradictory Artikel 3s on no information.
               */
              policy: retrieval.chunks
                .map((chunk) =>
                  `[${chunk.chunk_id}] ${chunk.heading ?? chunk.clause_ref ?? "(no heading)"}\n${chunk.content}`
                )
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
     * Rail 3's authority, read from the rules table — the ROW, not just its existence.
     *
     * At most one armed rule per organization per vertical, enforced by a partial unique index — docket
     * allowed several and silently took the newest, so "which rule authorised this" had no single answer.
     * Absent means not armed, which is the correct default for a product that authorises payments.
     *
     * This used to select `id` alone and pass a boolean to the rails, while the table stored a ceiling
     * and a currency. `bun run evals:rule` measured the cost: 190 of 300 labelled invoices released with
     * the model assumed wrong. Every column is read now, and `evaluateRule` is the only interpreter.
     */
    const rules = yield* Effect.orDie(db.scopedForOrg((sql, orgId) =>
      sql<{
        id: string
        vertical: string
        armed: boolean
        max_amount_minor: string | number | null
        currency: string
        require_po: boolean
        approved_suppliers: ReadonlyArray<string>
        min_payment_days: number
        description: string
      }>`
        select id, vertical, armed, max_amount_minor, currency, require_po, approved_suppliers,
               min_payment_days, description
          from rules
         where organization_id = ${orgId} and vertical = ${payload.vertical} and armed
      `
    ))

    /*
     * The unmet conditions, or `null` when there is no armed rule at all.
     *
     * Evaluated only when the model proposed `auto_approve` would matter — but computed unconditionally,
     * because the reasons are recorded on the row and a reviewer looking at a routed decision wants to
     * know which bound would have stopped it even when something else did first.
     */
    const ruleUnmet = rules.length === 0
      ? null
      : evaluateRule(
        new AutoApproveRule({
          ...rules[0]!,
          // bigint arrives as a string from the driver: Number() on it here is safe because a ceiling in
          // minor units cannot approach 2^53, and keeping it a string would make every comparison
          // lexicographic — which silently reads EUR 90,00 as above EUR 1.000,00.
          max_amount_minor: rules[0]!.max_amount_minor === null ? null : Number(rules[0]!.max_amount_minor),
          currency: rules[0]!.currency as AutoApproveRule["currency"]
        }),
        invoiceRuleFacts(extraction.fields as Invoice)
      )

    /*
     * (4) The rails. NOT an activity, and that is deliberate.
     *
     * An activity is memoised, and a memoised rail would mean a decision could be replayed past a rail
     * that has since been tightened. The rails are pure and free, so they run every time — and
     * `applyRails` is the only way to obtain the branded value the write below accepts.
     */
    const railed = applyRails({
      proposal,
      unverifiedSpans: extraction.unverified,
      arithmeticFailures: extraction.arithmeticFailures,
      chunkContent: new Map(retrieval.chunks.map((chunk) => [chunk.chunk_id, chunk.content])),
      ruleUnmet,
      retrievalMode: retrieval.mode
    })

    const decisionId = yield* ids.next
    const status = railed.outcome === "auto_approve" ? "auto_approved" : "pending_review"

    // A database failure here is not in the workflow's error channel and a caller could do nothing with
    // it: the decision either got written or it did not, and a defect is what makes the queue retry.
    yield* Effect.orDie(db.scopedForOrg((sql, orgId) =>
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

    /*
     * Reported AFTER the write, so a datapoint can never describe a decision that does not exist.
     *
     * Rail categories rather than full messages: the message names a specific field or clause, which is what
     * a reviewer needs and the wrong grain for a rate. `grounded` is the same input rail 1 read, not a
     * re-derivation — a metric that computes its own version of a check eventually disagrees with it.
     */
    const finishedAt = yield* Effect.clockWith((clock) => clock.currentTimeMillis)
    yield* telemetry.decision({
      vertical: payload.vertical,
      outcome: railed.outcome,
      railsFired: railed.railsFired.map((fired) => fired.split(":")[0]!),
      retrievalMode: railed.retrievalMode,
      grounded: extraction.unverified.length === 0 && extraction.arithmeticFailures.length === 0,
      citations: railed.citations.length,
      inputTokens: undefined,
      outputTokens: undefined,
      durationMillis: finishedAt - startedAt,
      replayed: false
    })

    return new DecideResult({
      decisionId,
      outcome: railed.outcome,
      railsFired: railed.railsFired,
      retrievalMode: railed.retrievalMode,
      replayed: false
    })
  })
)
