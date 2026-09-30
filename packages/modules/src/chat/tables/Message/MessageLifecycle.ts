/**
 * Edit and delete: two columns on `messages`.
 *
 * Its own file rather than a re-application of `MessageTable.ts`, and the reason is worth stating because the
 * repo does both. `0015_rule_conditions` re-applies `RuleTable` because its definition stays true — the change
 * is an idempotent superset. `MessageTable.ts` is no longer true: `0018_messages_rooms` dropped the columns its
 * index names, so re-applying it fails. Writing this as a re-application is exactly the mistake that produced
 * `column "subject_kind" does not exist`, one migration after a comment predicting it.
 *
 * Both statements are `add column if not exists`, so this is safe to re-run.
 */
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export const MessageLifecycle = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  /*
   * When the author last changed it. SURFACED rather than hidden: in a thread attached to a decision, an edited
   * note and an original are not the same evidence, and a reader who cannot tell them apart is worse off than one
   * who sees "edited" next to it. Same instinct as recording `retrieval_mode` on a decision — the conditions a
   * record was made under are part of the record.
   *
   * The previous text is not kept. A revision history is a real feature with its own table; a column nobody reads
   * would be its shape without its substance.
   */
  yield* sql`alter table messages add column if not exists edited_at timestamptz`

  /*
   * Deleting REDACTS the body and keeps the row, which is a decision with a real tension in it.
   *
   * Keeping the text would serve the audit trail — "why was this approved" is the kind of question a deleted note
   * might have answered — but a product that offers deletion and quietly retains the content is misrepresenting
   * what the button does. So the content goes and the row stays: who spoke, when, and that they removed it are
   * all still recorded, which is the auditable part a reader can act on.
   *
   * The decision itself is unaffected: an approval is its own immutable row with its own author and timestamp, so
   * removing a note cannot rewrite what was decided.
   */
  yield* sql`alter table messages add column if not exists deleted_at timestamptz`
})
