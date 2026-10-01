/**
 * Payment terms per customer: list them, set them, or clear them back to the default.
 *
 * Setting is an upsert on (organization, email). Clearing deletes the row — "no agreement" is the absence of one,
 * not a row holding the default, so changing the default later reaches every customer who never agreed otherwise.
 */
import { Db } from "@ea/database/Database"
import { CurrentUser } from "@ea/domain/Identity"
import { InvalidTerms } from "@ea/modules/sales/domain/Errors"
import { customerKey, CustomerTerms, MAX_TERMS_DAYS } from "@ea/modules/sales/domain/Work"
import { Effect } from "effect"

interface TermsRow {
  customer_email: string
  terms_days: number
  updated_at: Date
}

const toTerms = (row: TermsRow) =>
  new CustomerTerms({
    customerEmail: row.customer_email,
    termsDays: row.terms_days,
    updatedAt: row.updated_at.toISOString()
  })

export const ListCustomerTerms = Effect.flatMap(Db, (db) =>
  db.scoped((sql, orgId) =>
    Effect.map(
      sql<TermsRow>`
        select customer_email, terms_days, updated_at from customer_terms
         where organization_id = ${orgId} order by customer_email
      `,
      (rows) => rows.map(toTerms)
    )
  ))

/** Sets a customer's terms, or clears them when `termsDays` is null. Returns the full list after the change. */
export const SetCustomerTerms = (email: string, termsDays: number | null) =>
  Effect.gen(function*() {
    const key = customerKey(email)
    // A shape check, not validation of deliverability: the point is to refuse a name typed into the email box.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key)) {
      return yield* new InvalidTerms({ reason: `"${email}" is geen e-mailadres` })
    }
    if (termsDays !== null && (!Number.isInteger(termsDays) || termsDays < 0 || termsDays > MAX_TERMS_DAYS)) {
      return yield* new InvalidTerms({
        reason: `de betalingstermijn moet een heel aantal dagen zijn, van 0 tot ${MAX_TERMS_DAYS}`
      })
    }
    const db = yield* Db
    const user = yield* CurrentUser
    yield* db.scoped((sql, orgId) =>
      termsDays === null
        ? sql`delete from customer_terms where organization_id = ${orgId} and customer_email = ${key}`
        : sql`
            insert into customer_terms (organization_id, customer_email, terms_days, updated_by)
            values (${orgId}, ${key}, ${termsDays}, ${user.userId})
            on conflict (organization_id, customer_email)
            do update set terms_days = excluded.terms_days, updated_by = excluded.updated_by, updated_at = now()
          `
    )
    return yield* ListCustomerTerms
  })
