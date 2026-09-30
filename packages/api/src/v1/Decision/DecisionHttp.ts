/**
 * The transport edge for decisions: the queue as a collection, and one decision in full.
 *
 * This is the half of the asynchronous contract that `POST /intakes` promises. Its 202 hands back an
 * `intake_id`, and `GET /decisions?intake_id=` is what that id is for.
 */
import { DecisionNotFoundV1, DecisionNotPendingV1 } from "@ea/modules/decision/domain/Decision"
import { ApproveDecision, GetDecision, ListQueue, RejectDecision } from "@ea/modules/decision/use-cases/Decision"
import { clampPageSize } from "@ea/modules/shared/domain/Page"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { ApiV1 } from "../ApiV1.ts"
import { keyset2, page } from "../Page.ts"
import { serveForTenant } from "../Serve.ts"

/**
 * A review's outcome, or the 409 that says somebody else got there first.
 *
 * `NotPending` is not an error in the use case — exactly one of two concurrent callers wins, and losing is the
 * normal outcome rather than a fault. At the transport it has to become one, because HTTP has no way to say
 * "your request was understood and did nothing" other than a status code, and 200 would tell a client its
 * approval took effect.
 */
const settle = <E, R>(
  decisionId: string,
  review: Effect.Effect<{ readonly _tag: string }, E, R>,
  result: "approved" | "rejected"
) =>
  Effect.gen(function*() {
    /*
     * Existence is checked FIRST, and a runtime test is why.
     *
     * The compare-and-swap matches only a `pending_review` row, so it reports nothing-updated identically for
     * "no such decision" and "somebody already settled it" — and the first version of this answered **409 for an
     * id that does not exist**, which tells a client the decision is there and merely closed. Reading it first
     * separates them. The extra query is tenant-scoped, so it reveals existence only inside the caller's own
     * organization.
     *
     * The race is harmless: if it settles between the read and the write, the answer is 409, which is correct.
     */
    const existing = yield* serveForTenant(GetDecision({ decisionId }))
    if (existing === null) return yield* Effect.fail(new DecisionNotFoundV1({ decision_id: decisionId }))

    const outcome = yield* serveForTenant(review)
    return outcome._tag === "NotPending"
      ? yield* Effect.fail(new DecisionNotPendingV1({ decision_id: decisionId }))
      : { decisionId, result }
  })

export const DecisionHttp = HttpApiBuilder.group(
  ApiV1,
  "decisions",
  (handlers) =>
    handlers
      .handle("list", ({ query }) =>
        Effect.gen(function*() {
          const after = yield* keyset2(query.cursor)
          const limit = clampPageSize(query.limit)
          const items = yield* serveForTenant(
            ListQueue({
              limit,
              ...after === undefined ? {} : { after },
              ...query.intake_id === undefined ? {} : { intakeId: query.intake_id }
            })
          )
          // The keyset must match the ORDER the use case returns, which for the queue is oldest-first by
          // `decided_at` and then by id. Getting this wrong pages from the wrong row rather than failing.
          return page(items, limit, (item) => [item.decidedAt, item.decisionId])
        }))
      .handle("get", ({ params }) =>
        Effect.flatMap(
          serveForTenant(GetDecision({ decisionId: params.decisionId })),
          (detail) =>
            /*
             * `GetDecision` answers null for "not in your organization" AND for "does not exist", and the edge
             * keeps them indistinguishable. Telling them apart would make the endpoint an oracle for whether an
             * id exists in somebody else's account.
             */
            detail === null
              ? Effect.fail(new DecisionNotFoundV1({ decision_id: params.decisionId }))
              : Effect.succeed(detail)
        ))
      /*
       * Both actions call the SAME use case the console does, which is the point: `ApproveDecision` holds the
       * compare-and-swap and the single emit call site that a `grep -c` test asserts. A second transport must be
       * a second door onto one path, never a second path — an approval that reached execution another way would
       * break the claim that a human approval and an automatic one are indistinguishable downstream.
       *
       * `serveForTenant`, matching `DecisionRpcLive`: settling reads the tenant through `Db.scoped` AND records
       * `approved_by` from `CurrentUser`, and `serveForTenant` supplies the first while still requiring the
       * second. `serve` alone left `CurrentOrg` in the per-request door, which is where the compiler caught it.
       */
      .handle("approve", ({ params }) => settle(params.decisionId, ApproveDecision(params.decisionId), "approved"))
      .handle("reject", ({ params }) => settle(params.decisionId, RejectDecision(params.decisionId), "rejected"))
)
