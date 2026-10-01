/**
 * `Usage.report` over RPC — the console's usage page. Same use case and the same period rule as the v1 HTTP edge.
 */
import { UsageReport, UsageRpcs } from "@ea/modules/shared/domain/Usage"
import { GetUsage, resolveUsagePeriod } from "@ea/modules/shared/use-cases/Usage"
import { Effect } from "effect"
import { serveForTenant } from "../Serve.ts"

export const UsageRpcLive = UsageRpcs.toLayer(
  Effect.succeed({
    "Usage.report": (payload: { readonly from?: string | undefined; readonly to?: string | undefined }) =>
      Effect.flatMap(
        resolveUsagePeriod(payload, new Date()),
        (period) => serveForTenant(GetUsage(period)).pipe(Effect.map((report) => new UsageReport(report)))
      )
  })
)
