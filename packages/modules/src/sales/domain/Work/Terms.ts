/**
 * A customer's payment terms: how many days after an invoice is issued it falls due.
 *
 * Keyed by email, lower-cased — the one stable identity a quote carries. A customer without terms has the default
 * (`PAYMENT_TERMS_DAYS`), and an invoice copies its terms into its due date when issued, so a later change never
 * moves an invoice already sent.
 */
import { Schema } from "effect"

/** The longest terms accepted. A year is generous; more is far likelier a typo than an agreement. */
export const MAX_TERMS_DAYS = 365

export class CustomerTerms extends Schema.Class<CustomerTerms>("CustomerTerms")({
  customerEmail: Schema.String,
  termsDays: Schema.Int,
  updatedAt: Schema.String
}) {}

/** The key an email is stored and matched under. */
export const customerKey = (email: string) => email.trim().toLowerCase()
