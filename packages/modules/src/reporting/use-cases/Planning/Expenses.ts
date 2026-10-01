/**
 * The expenses the cash forecast counts: list, add, stop.
 *
 * Stopping never deletes. A monthly expense stops paying from today; a one-off that has not been paid yet is
 * withdrawn the same way. Either way the row records when, so an earlier forecast can still be explained.
 */
import { Db } from "@ea/database/Database"
import { CurrentUser } from "@ea/domain/Identity"
import { Ids } from "@ea/domain/Ids"
import { ExpenseNotFound, InvalidExpense } from "@ea/modules/reporting/domain/Errors"
import { Expense, type ExpenseRepeat } from "@ea/modules/reporting/domain/Planning"
import { Effect } from "effect"

interface ExpenseRow {
  id: string
  description: string
  amount_cents: number
  starts_on: string
  repeat: ExpenseRepeat
  stopped_on: string | null
}

const toExpense = (row: ExpenseRow) =>
  new Expense({
    id: row.id,
    description: row.description,
    amountCents: row.amount_cents,
    startsOn: row.starts_on,
    repeat: row.repeat,
    stoppedOn: row.stopped_on
  })

/** Expenses still in force: monthly ones not stopped, and one-offs not withdrawn. */
export const ListExpenses = Effect.flatMap(Db, (db) =>
  db.scoped((sql, orgId) =>
    Effect.map(
      sql<ExpenseRow>`
        select id, description, amount_cents, to_char(starts_on, 'YYYY-MM-DD') as starts_on, repeat,
               to_char(stopped_on, 'YYYY-MM-DD') as stopped_on
          from expenses where organization_id = ${orgId} and stopped_on is null
         order by starts_on, description
      `,
      (rows) => rows.map(toExpense)
    )
  ))

const isDay = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)

export const AddExpense = (input: {
  readonly description: string
  readonly amountCents: number
  readonly startsOn: string
  readonly repeat: ExpenseRepeat
}) =>
  Effect.gen(function*() {
    const description = input.description.trim()
    if (description.length === 0 || description.length > 200) {
      return yield* new InvalidExpense({ reason: "a description of 1 to 200 characters is required" })
    }
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      return yield* new InvalidExpense({ reason: "the amount must be more than zero" })
    }
    // `isDay` round-trips the date, so 2026-02-30 is refused rather than silently becoming 2 March.
    if (!isDay(input.startsOn)) return yield* new InvalidExpense({ reason: `"${input.startsOn}" is not a date` })
    const db = yield* Db
    const ids = yield* Ids
    const user = yield* CurrentUser
    const id = yield* ids.next
    yield* db.scoped((sql, orgId) =>
      sql`
        insert into expenses (id, organization_id, description, amount_cents, starts_on, repeat, created_by)
        values (${id}, ${orgId}, ${description}, ${input.amountCents}, ${input.startsOn}::date, ${input.repeat},
                ${user.userId})
      `
    )
    return yield* ListExpenses
  })

export const StopExpense = (expenseId: string) =>
  Effect.gen(function*() {
    const db = yield* Db
    const stopped = yield* db.scoped((sql, orgId) =>
      sql<{ id: string }>`
        update expenses set stopped_on = (now() at time zone 'UTC')::date
         where organization_id = ${orgId} and id = ${expenseId} and stopped_on is null
        returning id
      `
    )
    if (stopped.length === 0) return yield* new ExpenseNotFound({ expenseId })
    return yield* ListExpenses
  })
