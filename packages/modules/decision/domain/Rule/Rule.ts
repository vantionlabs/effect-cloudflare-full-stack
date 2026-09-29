/**
 * An auto-approve rule: the stored authority rail 3 requires, and the bounds that come with it.
 *
 * **Why this is a bounded authorisation and not a boolean.** Rail 3 used to ask only whether *an* armed
 * rule existed, while the `rules` table already stored `max_amount_minor` and `currency` — a ceiling
 * that nothing read. `bun run evals:rule` measured what that cost: with the model assumed wrong, 190 of
 * 300 labelled invoices reached `auto_approve`, including a EUR 118,683 one and every deliberate
 * duplicate. A ceiling nobody enforces is worse than no ceiling, because it reads like a control.
 *
 * So a rule is a conjunction of conditions, every one of which must hold. Each condition is
 * **null-means-unbounded**, and that is deliberate rather than convenient: an organisation arming
 * automatic payment has to decide each bound consciously, and omitting a field is how a bound gets
 * forgotten. `null` says "we decided not to bound this"; it does not say "we did not think about it".
 * Which of the two it really was is recorded in `description` and shown to the reviewer.
 */
import { Currency } from "@ea/modules/shared/domain/Money"
import { Schema } from "effect"

/**
 * The conditions an armed rule may impose. All of them, or a caller can forget one.
 *
 * Deliberately NOT extensible at runtime — no predicate expressions, no stored JSON DSL. A condition
 * set that can express anything is a condition set nobody can audit, and this is the object that
 * authorises paying a supplier without a human. Adding a condition is a migration and a code change,
 * which is the correct amount of friction.
 */
export class AutoApproveRule extends Schema.Class<AutoApproveRule>("AutoApproveRule")({
  id: Schema.String,
  vertical: Schema.String,
  /** A rule that exists but is not armed is a draft, and drafts must not approve payments. */
  armed: Schema.Boolean,
  /** Integer minor units. Null means no ceiling. */
  max_amount_minor: Schema.NullOr(Schema.Number),
  /** The only currency this rule authorises. A rule is never currency-agnostic by accident. */
  currency: Currency,
  /** When true, an invoice with no purchase order number is never approved automatically. */
  require_po: Schema.Boolean,
  /** Empty means any supplier. Non-empty means this exact list, matched case-insensitively. */
  approved_suppliers: Schema.Array(Schema.String),
  /**
   * The minimum days between issue and due date. Zero means unbounded.
   *
   * A short payment term is a known invoice-fraud indicator, which is why it is a bound a rule can
   * impose rather than something only the model notices in the policy text.
   */
  min_payment_days: Schema.Number,
  description: Schema.String
}) {}

/** What a rule is evaluated against: the facts, already extracted and already parsed. */
export interface RuleFacts {
  /** Integer minor units, from `parseMoney`. Null when the amount could not be read exactly. */
  readonly totalMinor: number | null
  readonly currency: Currency
  readonly supplier: string
  /** Null when the document states none, which is different from an empty string. */
  readonly poNumber: string | null
  /** Null when either date was unreadable; the check then fails rather than passing by omission. */
  readonly paymentDays: number | null
}
