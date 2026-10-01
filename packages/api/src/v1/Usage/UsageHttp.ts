/**
 * `GET /api/v1/usage` — the caller's organization's metered usage over a period.
 *
 * The period is validated here, at the edge, because both bounds come from a query string: `to` must be after
 * `from`, and a span over 366 days is refused rather than summed, so a careless request cannot make Postgres
 * aggregate an organization's whole history. Omitted, it is the current calendar month in UTC.
 */
import { UsageDayV1, UsageReportV1, UsageTotalV1 } from "@ea/modules/shared/domain/Usage"
import { currentMonth, GetUsage } from "@ea/modules/shared/use-cases/Usage"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/http-api"
import { ApiV1 } from "../ApiV1.ts"
import { serveForTenant } from "../Serve.ts"

const DAY_MS = 86_400_000
const MAX_SPAN_DAYS = 366

/** Both bounds given, one given, or neither; always a half-open `[from, to)` in whole UTC days. */
const periodFrom = (query: { readonly from?: string | undefined; readonly to?: string | undefined }) => {
  const month = currentMonth(new Date())
  const from = query.from ?? month.from
  const to = query.to ?? month.to
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS
  return Number.isFinite(span) && span > 0 && span <= MAX_SPAN_DAYS
    ? Effect.succeed({ from, to })
    : Effect.fail(new HttpApiError.BadRequest())
}

export const UsageHttp = HttpApiBuilder.group(
  ApiV1,
  "usage",
  (handlers) =>
    handlers.handle("report", ({ query }) =>
      Effect.gen(function*() {
        const period = yield* periodFrom(query)
        const report = yield* serveForTenant(GetUsage(period))
        return new UsageReportV1({
          from: report.from,
          to: report.to,
          totals: report.totals.map((row) => new UsageTotalV1(row)),
          daily: report.daily.map((row) => new UsageDayV1(row))
        })
      }))
)
