/**
 * rules: the stored authority that rail 3 requires before anything is approved automatically.
 *
 * The whole reason this table exists rather than a boolean on the organization: **a model's own
 * confidence score is not an authorisation.** Automatic approval has to point at something a human
 * armed deliberately, with a scope and a ceiling, and that is a row.
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
})
