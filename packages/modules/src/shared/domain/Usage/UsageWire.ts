/**
 * The v1 usage report, and the endpoint that serves it.
 *
 * Totals per meter (and per model, for model meters) over a period, plus a daily series for a chart. Snake_case
 * and frozen like every v1 shape. The period is a half-open UTC interval `[from, to)` in whole days, defaulting
 * to the current calendar month — the window an invoice covers.
 */
import { Authenticated } from "@ea/domain/Identity"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiError, HttpApiGroup } from "effect/http-api"
import { Meter } from "./Usage.ts"

/** `YYYY-MM-DD`, a UTC calendar day. */
export const Day = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)).annotate({
  identifier: "Day",
  description: "A UTC calendar day, YYYY-MM-DD."
})

export class UsageTotalV1 extends Schema.Class<UsageTotalV1>("UsageTotalV1")({
  meter: Meter,
  /** The model, for `model.*` meters. Null otherwise. */
  model: Schema.NullOr(Schema.String),
  quantity: Schema.Int
}) {}

export class UsageDayV1 extends Schema.Class<UsageDayV1>("UsageDayV1")({
  day: Day,
  meter: Meter,
  quantity: Schema.Int
}) {}

export class UsageReportV1 extends Schema.Class<UsageReportV1>("UsageReportV1")({
  /** Inclusive. */
  from: Day,
  /** Exclusive. */
  to: Day,
  totals: Schema.Array(UsageTotalV1),
  daily: Schema.Array(UsageDayV1)
}) {}

export const UsageGroup = HttpApiGroup.make("usage")
  .add(
    HttpApiEndpoint.get("report", "/usage", {
      query: {
        from: Schema.optional(Day),
        to: Schema.optional(Day)
      },
      success: UsageReportV1,
      // A period that ends before it starts, or spans more than a year.
      error: HttpApiError.BadRequest
    })
  )
  .middleware(Authenticated)
