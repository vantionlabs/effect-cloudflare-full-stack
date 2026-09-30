/**
 * `messages`: what people said, and the record a room is deliberately not.
 *
 * A room fans out and stores nothing (ADR-0018), so this table is the whole history. A reconnecting client
 * catches up from here, never from the room — which is why there is no ring buffer anywhere: one source cannot
 * disagree with itself, and a second copy would need an eviction rule whose failure mode is a reconnecting
 * client seeing a different thread from a reloading one.
 *
 * **Ordering is by `id`, not by `created_at`.** Ids are UUIDv7 and therefore time-ordered, so `order by id` is
 * chronological, `id >` is keyset pagination, and two messages posted in the same millisecond still have a
 * total order. `created_at` exists to be displayed. Having two orderings that can disagree is the bug this
 * avoids: `now()` is the transaction's start time, so two concurrent inserts can share it exactly.
 *
 * **There is no `seq` column** for the same reason there is no counter anywhere else in this codebase: it
 * would need either a sequence (gaps on rollback, which a catch-up query would read as lost messages) or a
 * `max(seq)+1` read-then-write per insert, which is a contention point on the hottest path in a chat.
 */
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export const MessageTable = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    create table if not exists messages (
      -- UUIDv7 from the Ids port: time-ordered, so this column is also the sort key and the cursor.
      id               text primary key,
      -- No FK to better-auth's organization table; see TenancyTable.ts.
      organization_id  text not null,
      /*
       * What the thread hangs off. A closed set, matching the domain's "SubjectKind" — an unrecognised
       * subject must not be storable, because nothing would ever read those rows.
       */
      subject_kind     text not null check (subject_kind in ('organization', 'decision')),
      /*
       * The decision's id, or the organization's own for the tenant-wide channel. No FK, and deliberately:
       * a thread must outlive the thing it discusses, or deleting a decision would silently delete the
       * argument about why it was approved — which is the opposite of an audit trail.
       */
      subject_id       text not null,
      -- better-auth owns the "user" table; the email is joined at read time rather than copied. See Message.ts.
      author_user_id   text not null,
      /*
       * Bounded here as well as in the wire schema. The schema gives a caller a good error; this makes it a
       * guarantee, including against anything that writes without going through the contract — a migration,
       * a script, a future transport.
       */
      body             text not null check (length(btrim(body)) > 0 and length(body) <= 4000),
      created_at       timestamptz not null default now()
    )
  `

  /*
   * The thread read, which is the only query shape this table has: one subject, ordered, optionally after a
   * cursor. "id" last so the index serves both the ordering and the keyset predicate.
   *
   * `organization_id` FIRST, because every query carries it — `Db.scoped` sees to that — so an index that did
   * not lead with it would be unusable for the only access pattern that exists.
   */
  yield* sql`
    create index if not exists messages_thread_idx
      on messages (organization_id, subject_kind, subject_id, id)
  `
})
