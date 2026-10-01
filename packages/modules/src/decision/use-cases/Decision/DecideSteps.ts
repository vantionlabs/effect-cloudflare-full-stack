/**
 * The decide pipeline's steps, each one independently runnable.
 *
 * Extracted from `DecideDocument.ts` so that **two orchestrators can drive the same work**: the
 * `effect/workflow` composition that tests and the eval harness run in Node, and the Cloudflare
 * `WorkflowEntrypoint` that production runs in `workerd` (ADR-0024). Neither owns the logic. That matters
 * beyond tidiness — the pipeline has to stay runnable outside `workerd`, because `evals/Decisions.ts` scores
 * it in Node against testcontainers Postgres and 509 lines of tests drive it there. A pipeline reachable
 * only through a `WorkflowEntrypoint` would take the only measurement of decision quality with it.
 *
 * ## What is a step and what is not
 *
 * A step is memoised by whichever orchestrator runs it, so the rule is: **a step may be replayed, and
 * replaying it must be harmless.**
 *
 *   `extractStep`   memoised — the expensive one, ~€0.05 a call. This is what the memo exists for.
 *   `retrieveStep`  memoised — cheap, but a replay must see the SAME clauses or the decision would be
 *                   justified against a corpus that has since changed underneath it.
 *   `decideStep`    memoised — a model call.
 *
 * And deliberately NOT steps:
 *
 *   the rails       a memoised rail could be replayed past a rail that has since been tightened. They are
 *                   pure and free, so they run every time — and `applyRails` is the only way to obtain the
 *                   branded value the write accepts.
 *   the write       guarded by `decide_key UNIQUE` and short-circuited before anything else, which is a
 *                   stronger guarantee than a memo and strictly earlier.
 *
 * Each step's output crosses a serialisation boundary — JSONB for the Postgres engine, a step result for
 * Cloudflare — so every one returns an encodable schema and never a live object.
 */
import { Db, textArray } from "@ea/database/Database"
import { Ids } from "@ea/domain/Ids"
import { applyRails, type Outcome, ProposedDecision } from "@ea/modules/decision/domain/Decision"
import { checkArithmetic, INVOICE, Invoice, invoiceRuleFacts } from "@ea/modules/decision/domain/Invoice"
import { AutoApproveRule, evaluateRule } from "@ea/modules/decision/domain/Rule"
import { Telemetry } from "@ea/modules/decision/domain/Telemetry"
import { ExtractDocument } from "@ea/modules/decision/use-cases/Extraction"
import { Cents } from "@ea/modules/shared/domain/Money"
import { PolicySearch } from "@ea/modules/shared/domain/Retrieval"
import type { Retrieval } from "@ea/modules/shared/domain/Retrieval"
import { modelUsageOf } from "@ea/modules/shared/domain/Usage"
import { recordModelUsage, writeUsage } from "@ea/modules/shared/use-cases/Usage"
import { Effect, Schema } from "effect"
import { LanguageModel } from "effect/ai"
import { decideKey, DecideResult, proposePrompt } from "./DecideContract.ts"
import { EmitExecute } from "./EmitExecute.ts"

/**
 * What extraction hands downstream.
 *
 * Not the raw `ExtractionResult`: `retrievalQuery` is built HERE, where the typed invoice is still in hand,
 * so nothing downstream has to reach into an `unknown` — and the query is memoised with the rest, so a
 * replay retrieves with the same one.
 */
export const ExtractOutput = Schema.Struct({
  fields: Schema.Unknown,
  checksPassed: Schema.Boolean,
  unverified: Schema.Array(Schema.String),
  arithmeticFailures: Schema.Array(Schema.String),
  retrievalQuery: Schema.String
})

export type ExtractOutputValue = typeof ExtractOutput.Type

/**
 * (1) Extract. The expensive step, and therefore the one the memo is really for.
 *
 * `orDie` because a model failure is not in the pipeline's error channel: a caller can do nothing with
 * "the provider returned malformed JSON" except retry, which is what a defect already causes.
 */
export const extractStep = (payload: { readonly documentText: string }) =>
  Effect.map(
    Effect.orDie(
      ExtractDocument({
        documentText: payload.documentText,
        schema: Invoice,
        objectName: INVOICE,
        checkArithmetic
      }).pipe(
        // Recorded inside the step, straight after the call: a re-run step calls the model again, and that is
        // real spend. See `recordModelUsage`. `orDie` covers it too — a lost meter row is a defect, not a retry.
        Effect.tap((result) => recordModelUsage(result.modelUsage))
      )
    ),
    (result): ExtractOutputValue => ({
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

/**
 * (2) Retrieve, through the PORT.
 *
 * `decision` asks for applicable clauses and does not know that the answer comes from pgvector, a Dutch
 * tsvector index and RRF fused in one query.
 */
export const retrieveStep = (query: string) => Effect.flatMap(PolicySearch, (policy) => policy.search({ query }))

/**
 * (3) Decide. The model proposes; it does not decide.
 *
 * The HEADING is included and not just `clause_ref`, which is load-bearing on a real corpus: a client's
 * corpus contains a superseded policy retained for audit with the SAME article numbers and different
 * thresholds, so two chunks both carry `clause_ref` "Artikel 3" and only the heading distinguishes them.
 * Found by running the eval against the corpus with its distractors, where the model was being asked to
 * choose between two contradictory Artikel 3s on no information.
 */
export const decideStep = (options: {
  readonly fields: unknown
  readonly chunks: Retrieval["chunks"]
}) =>
  Effect.map(
    Effect.orDie(
      LanguageModel.generateObject({
        prompt: proposePrompt({
          fields: JSON.stringify(options.fields, null, 2),
          policy: options.chunks
            .map((chunk) =>
              `[${chunk.chunk_id}] ${chunk.heading ?? chunk.clause_ref ?? "(no heading)"}\n${chunk.content}`
            )
            .join("\n\n")
        }),
        schema: ProposedDecision,
        objectName: "ProposedDecision"
      }).pipe(Effect.tap((response) => recordModelUsage(modelUsageOf(response))))
    ),
    (response) => response.value
  )

/**
 * The short circuit, before any step runs.
 *
 * A redelivered message finds the existing decision and returns it. Cheaper than any memo and strictly
 * earlier: a memo saves re-running a step, this saves entering the pipeline at all. `undefined` means there
 * is no decision yet.
 *
 * A replay is REPORTED, flagged as such — silently returning would make every rate drift as redeliveries
 * accumulate, with the denominator counting messages while the numerator counted decisions.
 */
export const existingDecision = (payload: { readonly documentId: string; readonly vertical: string }) =>
  Effect.gen(function*() {
    const db = yield* Db
    const telemetry = yield* Telemetry
    const rows = yield* Effect.orDie(
      db.scopedForOrg((sql, orgId) =>
        sql<{ id: string; outcome: Outcome; rails_fired: ReadonlyArray<string>; retrieval_mode: string }>`
          select id, outcome, rails_fired, retrieval_mode from decisions
           where organization_id = ${orgId}
             and decide_key = ${decideKey(payload.documentId, payload.vertical)}
        `
      )
    )
    if (rows.length === 0) return undefined
    const row = rows[0]!
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
  })

/**
 * The rails, the write, the emit and the metric — everything after the last model call.
 *
 * Not a step, and the reasons are in this file's header. Kept as one function because the four are one
 * transaction of meaning: a decision that was railed but not written, or written but not counted, is a state
 * no query should be able to observe.
 */
export const settleDecision = (options: {
  /**
   * Narrowed to the ids it actually uses, and deliberately NOT the whole payload.
   *
   * The full `DecidePayloadValue` carries `documentText`, which this function never reads — and the
   * Cloudflare orchestration does not have it here at all, because the text is a step result rather than a
   * parameter. Taking the whole payload meant passing `documentText: ""` to satisfy a type, which is a lie
   * that later reads as truth.
   */
  readonly payload: { readonly documentId: string; readonly vertical: string }
  readonly extraction: ExtractOutputValue
  readonly retrieval: Retrieval
  readonly proposal: ProposedDecision
  readonly startedAt: number
}) =>
  Effect.gen(function*() {
    const db = yield* Db
    const ids = yield* Ids
    const telemetry = yield* Telemetry
    const { extraction, payload, proposal, retrieval } = options

    /*
     * Rail 3's authority, read from the rules table — the ROW, not just its existence.
     *
     * At most one armed rule per organization per vertical, enforced by a partial unique index — docket
     * allowed several and silently took the newest, so "which rule authorised this" had no single answer.
     * Absent means not armed, which is the correct default for a product that authorises payments.
     *
     * This used to select `id` alone and pass a boolean to the rails, while the table stored a ceiling and a
     * currency. `bun run evals:rule` measured the cost: 190 of 300 labelled invoices released with the model
     * assumed wrong. Every column is read now, and `evaluateRule` is the only interpreter.
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
     * Computed unconditionally even though it only matters when the model proposed `auto_approve`, because
     * the reasons are recorded on the row: a reviewer looking at a routed decision wants to know which bound
     * would have stopped it even when something else did first.
     */
    const ruleUnmet = rules.length === 0
      ? null
      : evaluateRule(
        new AutoApproveRule({
          ...rules[0]!,
          // bigint arrives as a string from the driver. `Number()` is safe because a ceiling in minor units
          // cannot approach 2^53, and keeping it a string would make every comparison lexicographic — which
          // silently reads EUR 90,00 as above EUR 1.000,00. `Cents.make` rather than a bare Number because
          // it VALIDATES: a ceiling that is somehow not an integer fails here rather than participating in a
          // money comparison.
          max_amount_minor: rules[0]!.max_amount_minor === null
            ? null
            : Cents.make(Number(rules[0]!.max_amount_minor)),
          currency: rules[0]!.currency as AutoApproveRule["currency"]
        }),
        invoiceRuleFacts(extraction.fields as Invoice)
      )

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

    /*
     * The write, as a CLAIM rather than a plain insert — `on conflict … do nothing returning id`.
     *
     * Two reasons, and the first is a bug that exists without it. **The existence read and this insert are
     * not one transaction**, so two concurrent redeliveries both find no decision and both insert; one gets
     * a unique violation, which `orDie` turns into a defect. Today the queue retries and the short circuit
     * catches it, so it self-heals — but only because something outside is retrying.
     *
     * The second reason is what makes this necessary rather than tidy. Under Cloudflare Workflows this
     * function is a **step**, and a step is retried on its own: if the insert commits and something after it
     * fails, the retry re-enters here with the decision already written. A plain insert would then violate
     * the constraint on every attempt until the step exhausted its retries — a decision written and an
     * execution never emitted. Claiming makes the step idempotent, which is what a retryable step has to be.
     *
     * Zero rows back means somebody else owns this decision. It is the plan's own primitive: a single
     * statement that claims and reports.
     *
     * `scopedForOrg` wraps this in a transaction, so the decision and its citations are atomic — a conflict
     * therefore means BOTH are already there, and skipping the whole block is correct.
     */
    const claimed = yield* Effect.orDie(db.scopedForOrg((sql, orgId) =>
      Effect.gen(function*() {
        const inserted = yield* sql<{ id: string }>`
          insert into decisions (
            id, organization_id, document_id, vertical, decide_key, outcome, status, rationale,
            rails_fired, retrieval_mode, grounded, model
          ) values (
            ${decisionId}, ${orgId}, ${payload.documentId}, ${payload.vertical},
            ${decideKey(payload.documentId, payload.vertical)}, ${railed.outcome}, ${status},
            ${railed.rationale}, ${textArray(sql, railed.railsFired)}, ${railed.retrievalMode},
            ${extraction.checksPassed}, 'scripted'
          )
          on conflict (organization_id, decide_key) do nothing
          returning id
        `
        if (inserted.length === 0) return false
        for (const [ordinal, citation] of railed.citations.entries()) {
          yield* sql`
            insert into decision_citations (id, organization_id, decision_id, chunk_id, clause_ref, excerpt, ordinal)
            values (
              ${yield* ids.next}, ${orgId}, ${decisionId}, ${citation.chunk_id},
              ${citation.clause_ref}, ${citation.excerpt}, ${ordinal}
            )
          `
        }
        /*
         * Billed only by the claim's WINNER, inside the claim's transaction. A losing redelivery returns above
         * without reaching this, and the key is the decide key itself, so even a replayed winner counts once.
         */
        yield* writeUsage(sql, orgId, [{
          meter: "decisions.completed",
          quantity: 1,
          subjectId: decisionId,
          idempotencyKey: `decide:${decideKey(payload.documentId, payload.vertical)}`
        }])
        return true
      })
    ))

    /*
     * Somebody else wrote this decision. Report theirs rather than ours.
     *
     * `existingDecision` is reused so the replay is counted as a replay — the same reason the short circuit
     * reports one. Returning a `DecideResult` built from `decisionId` here would name a row that does not
     * exist, which is the worst possible answer: a caller would hold an id it could never read.
     */
    if (!claimed) {
      const winner = yield* existingDecision(payload)
      if (winner === undefined) {
        // The conflict says a row exists and the read says it does not, which no interleaving produces.
        return yield* Effect.die(
          new Error(`decide_key ${decideKey(payload.documentId, payload.vertical)} conflicted but is absent`)
        )
      }
      return winner
    }

    /*
     * The auto-approve branch, calling the SAME function the human path calls.
     *
     * The architectural claim the whole design turns on, and it was wired LAST on purpose: the human path was
     * built first, so this branch had to conform to it rather than the reverse. `dep:check` asserts exactly
     * one `EmitExecute` call site, and a test asserts an auto-approved execution row is identical to a
     * human-approved one but for `approved_by`.
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
      durationMillis: finishedAt - options.startedAt,
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
