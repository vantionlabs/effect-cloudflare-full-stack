/**
 * `message_mentions`: who a message named.
 *
 * **Resolved once, at write time, rather than parsed on every read.** The alternative — scanning bodies when a
 * thread is read — would re-run the same matching for every reader on every render, and would silently change
 * meaning when somebody's email changes: a message that named Alice would stop naming her. Storing the resolution
 * makes the mention a fact about what was written, which is the same reasoning as recording a citation rather
 * than re-deriving it.
 *
 * One row per (message, person), so naming somebody twice in one message mentions them once.
 */
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export const MentionTable = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    create table if not exists message_mentions (
      -- No FK to better-auth's organization table; see TenancyTable.ts.
      organization_id  text not null,
      message_id       text not null references messages(id) on delete cascade,
      /*
       * No FK to better-auth's "user" table either, and for a reason beyond the usual: a mention must survive the
       * person leaving. "Ask @alice" is what was said, and a thread that quietly loses the name when her account
       * goes is a worse record than one that shows a name nobody can click.
       */
      user_id          text not null,
      primary key (message_id, user_id)
    )
  `

  /* "What mentioned me", which is the query a notification list will want. */
  yield* sql`
    create index if not exists message_mentions_user_idx
      on message_mentions (organization_id, user_id)
  `
})
