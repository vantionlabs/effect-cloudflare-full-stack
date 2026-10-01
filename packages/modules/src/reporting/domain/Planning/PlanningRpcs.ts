/** The planning view: work in progress and the expected cash-in. Read-only. */
import { AuthenticatedRpc } from "@ea/domain/Identity"
import { Rpc, RpcGroup } from "effect/rpc"
import { PlanningView } from "./Planning.ts"

export const PlanningRpcs = RpcGroup.make(
  Rpc.make("Planning.view", { payload: {}, success: PlanningView })
).middleware(AuthenticatedRpc)
