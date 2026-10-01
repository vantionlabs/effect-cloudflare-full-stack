/** An expense the planning slice refuses: no description, a non-positive amount, or a date that is not a day. */
import { Schema } from "effect"

export class InvalidExpense extends Schema.TaggedError<InvalidExpense>()("InvalidExpense", {
  reason: Schema.String
}) {}
