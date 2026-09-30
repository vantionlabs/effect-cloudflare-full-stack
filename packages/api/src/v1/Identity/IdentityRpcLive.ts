/**
 * The identity RPC handlers.
 *
 * As thin as the HTTP twin, and for the same reason: `AuthenticatedRpc` has already done the session
 * lookup, so the handler reads the identity it was given. Both transports land on the same
 * `CurrentUser`, which is what makes "one authorization seam" true rather than aspirational.
 */
import { CurrentUser } from "@ea/domain/Identity"
import { IdentityRpcs } from "@ea/modules/iam/domain/Identity"
import { Effect } from "effect"

export const IdentityRpcLive = IdentityRpcs.toLayer(
  Effect.succeed({
    "Identity.me": () => Effect.map(CurrentUser, (identity) => identity)
  })
)
