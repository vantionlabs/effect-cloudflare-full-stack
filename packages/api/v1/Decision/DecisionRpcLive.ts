/**
 * The decision RPC handlers.
 *
 * Thin, like every other transport edge here: `AuthenticatedRpc` has resolved the identity, `withDatabase`
 * supplies the per-request connection, and the use cases do the work. Mapping `ReviewOutcome` to the wire's
 * `ReviewResult` happens here so the use case never learns a transport exists.
 */
import { DecisionRpcs } from "@ea/modules/decision/domain/Decision"
import { ApproveDecision, GetDecision, ListQueue, RejectDecision } from "@ea/modules/decision/use-cases/Decision"
import { Effect } from "effect"
import { serve, serveForTenant } from "../Serve.ts"

export const DecisionRpcLive = DecisionRpcs.toLayer(
  Effect.succeed({
    "Decision.queue": (payload: { readonly limit?: number | undefined }) => serve(ListQueue(payload)),

    "Decision.get": (payload: { readonly decisionId: string }) => serve(GetDecision(payload)),

    /*
     * Approve and reject need the TENANT, not the person — `approved_by` is recorded by the use case from
     * `CurrentUser`, which it asks for itself. The mapping to the wire's `ReviewResult` stays inline rather
     * than behind a helper: the two literals differ, and a helper parameterised by three strings would be
     * harder to read than the thing it replaced.
     */
    "Decision.approve": (payload: { readonly decisionId: string }) =>
      Effect.map(
        serveForTenant(ApproveDecision(payload.decisionId)),
        (outcome) => outcome._tag === "Approved" ? "approved" as const : "not_pending" as const
      ),

    "Decision.reject": (payload: { readonly decisionId: string }) =>
      Effect.map(
        serveForTenant(RejectDecision(payload.decisionId)),
        (outcome) => outcome._tag === "Rejected" ? "rejected" as const : "not_pending" as const
      )
  })
)
