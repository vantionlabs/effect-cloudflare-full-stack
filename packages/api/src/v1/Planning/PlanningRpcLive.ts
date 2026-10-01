/** `Planning.view` — work in progress and the expected cash-in, for the caller's organization. Read-only. */
import { PlanningRpcs } from "@ea/modules/reporting/domain/Planning"
import { GetPlanning } from "@ea/modules/reporting/use-cases/Planning"
import { Effect } from "effect"
import { serveForTenant } from "../Serve.ts"

export const PlanningRpcLive = PlanningRpcs.toLayer(
  Effect.succeed({
    "Planning.view": () => serveForTenant(GetPlanning)
  })
)
