/** An expected payment out, as the planning page lists it. See `ExpenseTable.ts` for how it is paid. */
import { Schema } from "effect"

export const ExpenseRepeat = Schema.Literals(["once", "monthly"])
export type ExpenseRepeat = typeof ExpenseRepeat.Type

export class Expense extends Schema.Class<Expense>("Expense")({
  id: Schema.String,
  description: Schema.String,
  /** Cents, VAT included. */
  amountCents: Schema.Int,
  startsOn: Schema.String,
  repeat: ExpenseRepeat,
  stoppedOn: Schema.NullOr(Schema.String)
}) {}
