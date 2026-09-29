/**
 * Evaluates an armed rule against the facts, returning the conditions it does NOT meet.
 *
 * Pure, total, and it returns **reasons rather than a boolean** for one reason: a reviewer looking at a
 * decision that was not approved automatically is entitled to know which bound stopped it, and "the
 * rule did not apply" is not an answer anybody can act on. Each string is shown verbatim.
 *
 * ## Unreadable is unmet
 *
 * Every check treats "we could not read this" as a failure, never as a pass. An amount that
 * `parseMoney` refused, a date pair that did not parse — each one means the bound cannot be shown to
 * hold, and a bound that cannot be shown to hold has not held. The alternative, skipping a check whose
 * input is missing, is how an invoice with an unparseable total slips past a ceiling.
 *
 * ## What this deliberately does not check
 *
 * Whether the invoice is a **duplicate**. That is not a property of the invoice in front of you — it is
 * a property of the corpus, and answering it needs a query. It belongs with the other deterministic
 * checks, not in a rule's conditions, and `document_fingerprints` is where it will live.
 */
import type { AutoApproveRule, RuleFacts } from "./Rule.ts"

/** Renders integer minor units for a human, in the reviewer's own convention. */
const amount = (minor: number, currency: string) => {
  const whole = String(Math.trunc(Math.abs(minor) / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  return `${currency} ${whole},${String(Math.abs(minor) % 100).padStart(2, "0")}`
}

/**
 * The unmet conditions, in the order they are declared on the rule. Empty means every bound held.
 *
 * An unarmed rule returns one reason rather than throwing: rail 3 asks this function the same question
 * whatever state the rule is in, and "not armed" is the most common honest answer.
 */
export const evaluateRule = (
  rule: AutoApproveRule,
  facts: RuleFacts
): ReadonlyArray<string> => {
  const unmet: Array<string> = []

  if (!rule.armed) {
    return [`authority: rule ${rule.id} is a draft, not armed`]
  }

  // Currency first, matching `Invoice`'s own declaration order: a ceiling means nothing until it is
  // settled what the figures are denominated in. A EUR 1.000 ceiling does not bound USD 1.000.
  if (facts.currency !== rule.currency) {
    unmet.push(
      `currency: invoice is in ${facts.currency} and the rule authorises ${rule.currency} only`
    )
  }

  if (rule.max_amount_minor !== null) {
    if (facts.totalMinor === null) {
      unmet.push("amount: the total could not be read exactly, so the ceiling cannot be shown to hold")
    } else if (facts.totalMinor > rule.max_amount_minor) {
      unmet.push(
        `amount: ${amount(facts.totalMinor, facts.currency)} is above the rule's ceiling of ` +
          `${amount(rule.max_amount_minor, rule.currency)}`
      )
    }
  }

  if (rule.require_po && (facts.poNumber === null || facts.poNumber.trim() === "")) {
    unmet.push("purchase_order: the rule requires a purchase order number and the invoice states none")
  }

  if (rule.approved_suppliers.length > 0) {
    // Case-insensitive and whitespace-normalised, because a supplier list is maintained by a human in a
    // spreadsheet and "Contoso Cleaning Services BV " is the same company. Nothing else is normalised:
    // a different legal form is a different entity.
    const normalise = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase()
    const invoiceSupplier = normalise(facts.supplier)
    if (!rule.approved_suppliers.some((approved) => normalise(approved) === invoiceSupplier)) {
      unmet.push(`supplier: ${facts.supplier} is not on the rule's approved supplier list`)
    }
  }

  if (rule.min_payment_days > 0) {
    if (facts.paymentDays === null) {
      unmet.push(
        "payment_terms: the payment term could not be determined, so the minimum cannot be shown to hold"
      )
    } else if (facts.paymentDays < rule.min_payment_days) {
      unmet.push(
        `payment_terms: ${facts.paymentDays} days to pay is under the rule's minimum of ` +
          `${rule.min_payment_days} days`
      )
    }
  }

  return unmet
}
