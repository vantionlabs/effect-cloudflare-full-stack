/**
 * rules: the stored authority that rail 3 requires before anything is approved automatically.
 *
 * The whole reason this table exists rather than a boolean on the organization: **a model's own
 * confidence score is not an authorisation.** Automatic approval has to point at something a human
 * armed deliberately, with a scope and a ceiling, and that is a row.
 *
 * **Every column here is read by `evaluateRule`, and that was not always true.** `max_amount_minor` and
 * `currency` existed from the first migration while rail 3 checked only `armed`, so the ceiling was
 * decoration. `bun run evals:rule` put a number on it: with the model assumed wrong, 190 of 300
 * labelled invoices reached `auto_approve`, including one for EUR 118,683. A bound nobody enforces is
 * worse than no bound, because it reads like a control. The three columns added in migration 15 close
 * the rest of that hole, and `evaluateRule` is the one place they are interpreted.
 *
 * The partial unique index is the fix for a specific docket bug: several armed rules could exist for
 * one organization and vertical, and the code silently picked the newest. Now at most one can be armed
 * at a time, so "which rule authorised this" always has one answer.
 */
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export const RuleTable = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    create table if not exists rules (
      id               text primary key,
      organization_id  text not null,
      vertical         text not null,
      -- Armed is deliberately explicit and deliberately not the default. A rule that exists but is
      -- not armed is a draft, and drafts must not approve payments.
      armed            boolean not null default false,
      /*
       * The ceiling, in integer minor units. Null means no ceiling, which is a decision someone has
       * to make consciously rather than by omitting a field.
       */
      max_amount_minor bigint,
      currency         text not null default 'EUR',
      -- Free text, shown to the reviewer beside any decision this rule authorised.
      description      text not null,
      created_by       text not null,
      created_at       timestamptz not null default now(),
      armed_by         text,
      armed_at         timestamptz
    )
  `

  /*
   * At most ONE armed rule per organization per vertical.
   *
   * Partial, so any number of unarmed drafts may coexist. docket allowed several armed ones and took
   * the newest, which meant the authority for a decision depended on insertion order.
   */
  yield* sql`
    create unique index if not exists rules_one_armed_per_vertical_idx
      on rules (organization_id, vertical)
      where armed
  `

  /*
   * The three bounds added after `evals:rule` measured what their absence cost.
   *
   * `add column if not exists` rather than a new table, so re-running is a no-op. The defaults split
   * into two kinds, and the distinction is the honest part:
   *
   * **`require_po` defaults to TRUE — restrictive.** "Every purchase above EUR 500 requires a purchase
   * order" is the policy in every corpus we have seen, so true is a safe guess, and defaulting a bound
   * permissively would silently widen an existing authorisation to pay suppliers on deploy.
   *
   * **`approved_suppliers` defaults to EMPTY, which `evaluateRule` reads as "any supplier" — permissive,
   * and unavoidably so.** A customer's approved supplier list cannot be guessed, and inventing one would
   * stop every payment. So this column starts as a real gap that the customer has to close, and it is
   * called out here rather than presented as a safe default. The same applies to `min_payment_days`,
   * which defaults to 0 (unbounded): there is no safe non-zero guess, since a supplier on genuinely
   * short contracted terms would stop being auto-approvable and surprising a customer into escalating
   * everything is its own kind of failure.
   *
   * What makes the permissive pair acceptable is that they are bounds on a rule that is **armed by a
   * human**, who sees the description and the bounds together. What would not be acceptable is a bound
   * that looks set and is not — which is precisely the bug this migration exists to fix.
   */
  yield* sql`alter table rules add column if not exists require_po boolean not null default true`
  yield* sql`
    alter table rules add column if not exists approved_suppliers text[] not null default '{}'::text[]
  `
  yield* sql`alter table rules add column if not exists min_payment_days integer not null default 0`
})
