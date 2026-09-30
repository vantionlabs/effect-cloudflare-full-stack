/**
 * The human boundary: a reviewer approves, and the decision becomes work.
 *
 * **Approval is a compare-and-swap, not an update.** The `where status = 'pending_review'` clause is the
 * concurrency control: two reviewers in two tabs both issue the update, one matches a row and one does not,
 * and only the winner emits. Without it both would emit, and the `events` unique key would be the only
 * thing standing between one approval and two — which works, but locates the guarantee in the wrong place
 * and makes the loser believe it succeeded.
 *
 * A rejection is the same shape and deliberately shares it: the only difference is the target status and
 * that nothing is emitted, and writing them as one function is what stops the two drifting apart.
 */
import { Db } from "@ea/database/Database"
import { CurrentUser } from "@ea/domain/Identity"
import { Effect } from "effect"
import { EmitExecute } from "./EmitExecute.ts"

export type ReviewOutcome =
  | { readonly _tag: "Approved"; readonly eventId: string }
  | { readonly _tag: "Rejected" }
  /** Somebody else already reviewed it, or it was never awaiting review. */
  | { readonly _tag: "NotPending" }

const settle = (decisionId: string, status: "approved" | "rejected") =>
  Effect.gen(function*() {
    const db = yield* Db
    const identity = yield* CurrentUser

    // The CAS. `pending_review` is the only state a review may act on.
    const changed = yield* db.scoped((sql, orgId) =>
      sql<{ id: string }>`
        update decisions
           set status = ${status}, reviewed_by = ${identity.userId}, reviewed_at = now()
         where id = ${decisionId}
           and organization_id = ${orgId}
           and status = 'pending_review'
        returning id
      `
    )

    return changed.length > 0
  })

export const ApproveDecision = (decisionId: string) =>
  Effect.gen(function*() {
    const won = yield* settle(decisionId, "approved")
    if (!won) return { _tag: "NotPending" } satisfies ReviewOutcome

    /*
     * Emitted only by the CAS winner, and AFTER the status write.
     *
     * The order matters for the same reason as in EmitEvent: the row is the recoverable record. If the
     * emit fails, the decision is approved and an event is missing — which the reconciliation cron finds by
     * looking for approved decisions with no executions row. The reverse order would emit work for a
     * decision that was never approved.
     */
    const event = yield* EmitExecute({ decisionId, action: "dry_run" })
    return { _tag: "Approved", eventId: event.eventId } satisfies ReviewOutcome
  })

export const RejectDecision = (decisionId: string) =>
  Effect.map(
    settle(decisionId, "rejected"),
    (won): ReviewOutcome => won ? { _tag: "Rejected" } : { _tag: "NotPending" }
  )
