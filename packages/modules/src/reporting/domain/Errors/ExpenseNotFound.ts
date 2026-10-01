/** No expense with this id in the caller's organization — or it was already stopped. */
import { Schema } from "effect"

export class ExpenseNotFound extends Schema.TaggedError<ExpenseNotFound>()("ExpenseNotFound", {
  expenseId: Schema.String
}) {}
