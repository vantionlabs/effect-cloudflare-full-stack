/**
 * `GET /api/v1/usage` — the caller's organization's metered usage over a period.
 *
 * The period is validated here, at the edge, because both bounds come from a query string: `to` must be after
 * `from`, and a span over 366 days is refused rather than summed, so a careless request cannot make Postgres
 * aggregate an organization's whole history. Omitted, it is the current calendar month in UTC.
 */
import { UsageDayV1, UsageReportV1, UsageTotalV1 } from "@ea/modules/shared/domain/Usage"
import { GetUsage, resolveUsagePeriod } from "@ea/modules/shared/use-cases/Usage"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/http-api"
import { ApiV1 } from "../ApiV1.ts"
import { serveForTenant } from "../Serve.ts"

export const UsageHttp = HttpApiBuilder.group(
  ApiV1,
  "usage",
  (handlers) =>
    handlers.handle("report", ({ query }) =>
      Effect.gen(function*() {
        const period = yield* resolveUsagePeriod(query, new Date()).pipe(
          Effect.mapError(() => new HttpApiError.BadRequest())
        )
        const report = yield* serveForTenant(GetUsage(period))
        return new UsageReportV1({
          from: report.from,
          to: report.to,
          totals: report.totals.map((row) => new UsageTotalV1(row)),
          daily: report.daily.map((row) => new UsageDayV1(row))
        })
      }))
)
