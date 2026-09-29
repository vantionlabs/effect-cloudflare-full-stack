/**
 * The ONE execution path. Both the human approval and the auto-approve branch call this function.
 *
 * That is the codebase's central architectural claim, and it is the reason this file exists separately
 * rather than as two similar blocks: an auto-approved decision must produce a **byte-identical**
 * `executions` row to a human-approved one, because otherwise "the automatic path does the same thing" is
 * an assertion nobody checks. `bun run dep:check` asserts exactly one call site for the emit, and a test
 * asserts the two rows agree field by field.
 *
 * ## The claim, and why it is one statement
 *
 *   insert into executions (...) on conflict (organization_id, idempotency_key) do nothing returning id
 *
 * Zero rows means **somebody else owns this** — not "retry", owns it. Two reviewers approving in two tabs
 * therefore produce one execution, and the loser finds out it lost. No advisory lock, no SELECT-then-INSERT
 * race, no TTL to tune.
 *
 * ## The window that cannot be closed
 *
 * Between `execute` returning and the status write landing, the process can die. The call happened; the
 * record does not exist. No transaction spans a database and someone else's API. Three mitigations, in
 * order of how much they actually help:
 *
 *   1. the provider's own dedupe key, so a replay is a no-op **at the provider**;
 *   2. an ambiguous `pending` is never auto-retried — it becomes `needs_attention` for a human;
 *   3. a cron reports stuck claims and must not resolve them.
 *
 * Getting this wrong pays a supplier twice.
 */
import { Adapter, AdapterRequest, type ExecutionAction, ExecutionId } from "@ea/modules/decision/domain/Execution"
import { Ids } from "@ea/modules/shared/domain/Ids"
import { Db } from "@ea/modules/shared/tables/Database"
import { Effect } from "effect"

export interface ExecuteDecisionInput {
  readonly decisionId: string
  readonly action: ExecutionAction
  /** Null for an auto-approved decision. The null is itself the audit record. */
  readonly approvedBy?: string | undefined
  readonly payload?: unknown
}

export type ExecuteOutcome =
  | { readonly _tag: "Executed"; readonly executionId: string }
  /** Somebody else holds the claim. Not an error: the work is being done, just not by us. */
  | { readonly _tag: "AlreadyClaimed" }
  /** The call may or may not have happened. A human decides; we do not retry. */
  | { readonly _tag: "Ambiguous"; readonly executionId: string; readonly reason: string }

/** The derived key. One function so the events row and the executions row cannot diverge. */
export const executionKey = (decisionId: string, action: ExecutionAction) => `decision:${decisionId}:${action}`

export const ExecuteDecision = (input: ExecuteDecisionInput) =>
  Effect.gen(function*() {
    const db = yield* Db
    const ids = yield* Ids
    const adapter = yield* Adapter

    const key = executionKey(input.decisionId, input.action)
    const executionId = ExecutionId.make(yield* ids.next)

    // (1) Claim. One statement, and its emptiness is the answer.
    const claimed = yield* db.scopedForOrg((sql, orgId) =>
      sql<{ id: string }>`
        insert into executions (
          id, organization_id, decision_id, action, idempotency_key, provider_idempotency_key, approved_by
        ) values (
          ${executionId}, ${orgId}, ${input.decisionId}, ${input.action}, ${key}, ${key},
          ${input.approvedBy ?? null}
        )
        on conflict (organization_id, idempotency_key) do nothing
        returning id
      `
    )

    if (claimed.length === 0) {
      return { _tag: "AlreadyClaimed" } satisfies ExecuteOutcome
    }

    // (2) Act. Everything after this point is about a call that may already have happened.
    const result = yield* Effect.result(
      adapter.execute(
        new AdapterRequest({
          decisionId: input.decisionId,
          action: input.action,
          // The provider's dedupe key, so a replay is a no-op at the target rather than a second payment.
          idempotencyKey: key,
          payload: input.payload ?? {}
        })
      )
    )

    if (result._tag === "Success") {
      yield* db.scopedForOrg((sql, orgId) =>
        sql`
          update executions
             set status = 'succeeded', response = ${JSON.stringify(result.success)}::jsonb,
                 finished_at = now()
           where id = ${executionId} and organization_id = ${orgId}
        `
      )
      return { _tag: "Executed", executionId } satisfies ExecuteOutcome
    }

    /*
     * (3) The adapter failed — and we cannot know whether it acted first.
     *
     * `needs_attention`, never a retry. An adapter without provider-side idempotency could act twice on a
     * retry, and one that has it does not need us to retry: the reconciliation path can ask via `lookup`.
     * Either way the answer is a human, which is why `decisions.status` moves too.
     */
    const reason = result.failure.message
    yield* db.scopedForOrg((sql, orgId) =>
      Effect.gen(function*() {
        yield* sql`
          update executions
             set status = 'needs_attention', error = ${reason}, finished_at = now()
           where id = ${executionId} and organization_id = ${orgId}
        `
        yield* sql`
          update decisions set status = 'needs_attention'
           where id = ${input.decisionId} and organization_id = ${orgId}
        `
      })
    )

    return { _tag: "Ambiguous", executionId, reason } satisfies ExecuteOutcome
  })
