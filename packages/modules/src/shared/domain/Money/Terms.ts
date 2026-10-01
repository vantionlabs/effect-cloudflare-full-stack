/**
 * Payment terms, in days: how long after an invoice is issued it is due.
 *
 * In `shared` because two slices depend on it and must agree: `sales` sets an invoice's due date with it, and
 * `reporting` forecasts when work not yet invoiced will turn into cash with it. Two copies could drift, and a
 * forecast built on different terms than the invoices it forecasts would be wrong without anything failing.
 * One product-wide value for now; per-customer terms are a later column, not a hidden default.
 */
export const PAYMENT_TERMS_DAYS = 30
