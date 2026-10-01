/**
 * A usage period that ends before it starts, is not a pair of `YYYY-MM-DD` days, or spans more than 366 days —
 * refused rather than summed, so a careless request cannot make Postgres aggregate an organization's history.
 */
import { Schema } from "effect"

export class InvalidUsagePeriod extends Schema.TaggedError<InvalidUsagePeriod>()("InvalidUsagePeriod", {
  from: Schema.String,
  to: Schema.String
}) {}
