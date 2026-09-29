/**
 * The decision RPC handlers.
 *
 * Thin, like every other transport edge here: `AuthenticatedRpc` has resolved the identity, `withDatabase`
 * supplies the per-request connection, and the use cases do the work. Mapping `ReviewOutcome` to the wire's
 * `ReviewResult` happens here so the use case never learns a transport exists.
 */
import { DecisionRpcs } from "@ea/modules/decision/domain/Decision"
import { ApproveDecision, GetDecision, ListQueue, RejectDecision } from "@ea/modules/decision/use-cases/Decision"
import { withDatabase } from "@ea/modules/shared/tables/Database"
import { Effect } from "effect"

export const DecisionRpcLive = DecisionRpcs.toLayer(
  Effect.succeed({
    "Decision.queue": (payload: { readonly limit?: number | undefined }) =>
      Effect.orDie(withDatabase(ListQueue(payload))),

    "Decision.get": (payload: { readonly decisionId: string }) => Effect.orDie(withDatabase(GetDecision(payload))),

    "Decision.approve": (payload: { readonly decisionId: string }) =>
      Effect.orDie(
        Effect.map(
          withDatabase(ApproveDecision(payload.decisionId)),
          (outcome) => outcome._tag === "Approved" ? "approved" as const : "not_pending" as const
        )
      ),

    "Decision.reject": (payload: { readonly decisionId: string }) =>
      Effect.orDie(
        Effect.map(
          withDatabase(RejectDecision(payload.decisionId)),
          (outcome) => outcome._tag === "Rejected" ? "rejected" as const : "not_pending" as const
        )
      )
  })
)
