/**
 * The decision RPC handlers.
 *
 * Thin, like every other transport edge here: `AuthenticatedRpc` has resolved the identity, `withDatabase`
 * supplies the per-request connection, and the use cases do the work. Mapping `ReviewOutcome` to the wire's
 * `ReviewResult` happens here so the use case never learns a transport exists.
 */
import { DecisionRpcs } from "@ea/modules/decision/domain/Decision"
import { ApproveDecision, GetDecision, ListQueue, RejectDecision } from "@ea/modules/decision/use-cases/Decision"
import { orgRoom, QueueChanged, Rooms } from "@ea/modules/realtime/domain/Room"
import { CurrentUser } from "@ea/modules/shared/domain/Identity"
import { Effect } from "effect"
import { serve, serveForTenant } from "../Serve.ts"

/**
 * Tell the organization's room that the queue moved.
 *
 * **After the write, never instead of it.** The database is the record; this is a nudge that carries no rows
 * (see RoomFrame.ts), so a client that misses it is one refresh behind rather than wrong. `broadcast` cannot
 * fail, by design — failing somebody's approval because a notification did not send would be strictly worse
 * than a briefly stale queue.
 *
 * `byUserId` lets a console ignore its own echo. Without it, the person who just clicked Approve refetches
 * the queue because of their own action, which is the one case where a refetch is certainly pointless.
 *
 * Here rather than in the use case, deliberately: `ApproveDecision` also runs from the queue consumer, which
 * has no `CurrentUser` and no socket to announce to. Announcing is something the *interactive* edge does.
 */
const announce = (reason: "approved" | "rejected") =>
  Effect.gen(function*() {
    const rooms = yield* Rooms
    const identity = yield* CurrentUser
    yield* rooms.broadcast(orgRoom(identity.orgId), new QueueChanged({ reason, byUserId: identity.userId }))
  })

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
      ).pipe(
        /*
         * Announced only when something actually changed. `not_pending` means somebody else got there first
         * — the CAS lost — and the person who won has already announced it. Nudging on a lost race would
         * make every contended approval fan out twice.
         */
        Effect.tap((result) => result === "approved" ? announce("approved") : Effect.void)
      ),

    "Decision.reject": (payload: { readonly decisionId: string }) =>
      Effect.map(
        serveForTenant(RejectDecision(payload.decisionId)),
        (outcome) => outcome._tag === "Rejected" ? "rejected" as const : "not_pending" as const
      ).pipe(
        Effect.tap((result) => result === "rejected" ? announce("rejected") : Effect.void)
      )
  })
)
