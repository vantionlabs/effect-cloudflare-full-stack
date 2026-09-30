/**
 * `message_reactions`: who reacted to what, with which emoji.
 *
 * **The primary key is the whole row**, which is what makes reacting idempotent without a read: `(message_id,
 * user_id, emoji)` means a second identical insert conflicts instead of producing a duplicate, so a double tap
 * cannot count twice. Toggling off is a delete on the same key.
 *
 * `organization_id` is carried here as well as on `messages`, denormalised on purpose. Every table in this
 * codebase does, because `Db.scoped` adds the predicate to every query and a table without the column could only
 * be scoped by joining to one that has it — a join the tenancy check cannot see, on the hot path of every read.
 */
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export const ReactionTable = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    create table if not exists message_reactions (
      -- No FK to better-auth's organization table; see TenancyTable.ts.
      organization_id  text not null,
      message_id       text not null references messages(id) on delete cascade,
      user_id          text not null,
      /*
       * Any short string, not a closed set.
       *
       * A fixed palette would be simpler to validate and wrong for a chat: the reactions people actually use are
       * the ones they choose. Bounded at 32 characters because a grapheme cluster with modifiers is several code
       * points and because this is a key, not a message — anything longer is not an emoji, it is a payload.
       */
      emoji            text not null check (length(emoji) between 1 and 32),
      created_at       timestamptz not null default now(),
      primary key (message_id, user_id, emoji)
    )
  `

  /*
   * The read: every reaction on a page of messages, grouped. Leads with `organization_id` because every query
   * carries it, then `message_id` because that is what a thread read filters on.
   */
  yield* sql`
    create index if not exists message_reactions_lookup_idx
      on message_reactions (organization_id, message_id)
  `
})
