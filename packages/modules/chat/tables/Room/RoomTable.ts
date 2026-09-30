/**
 * `rooms`: where messages live, one row per channel and one per decision thread.
 *
 * Two kinds in one table. They share everything downstream — messages, and later reactions and read state, all
 * key off a room id — so splitting them would mean two foreign keys and a branch everywhere, to save two
 * nullable columns and two partial unique indexes here.
 *
 * A room is still NOT the socket fan-out target: broadcasts go to the organization's socket room with the room
 * id inside the frame, so there is one socket per person and no subscribe protocol. A row per room and a socket
 * per room are separate decisions (ADR-0018).
 */
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export const RoomTable = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    create table if not exists rooms (
      id               text primary key,
      -- No FK to better-auth's organization table; see TenancyTable.ts.
      organization_id  text not null,
      kind             text not null check (kind in ('channel', 'decision')),
      name             text not null check (length(btrim(name)) > 0 and length(name) <= 80),
      /*
       * The URL-safe handle, derived from the name. Null for a decision thread, which nobody addresses by a
       * handle — it is reached through the decision.
       */
      slug             text,
      topic            text check (topic is null or length(topic) <= 300),
      /*
       * The decision a thread hangs off. No FK, deliberately: a thread must outlive the thing it discusses, or
       * deleting a decision would silently delete the argument about why it was approved.
       */
      subject_id       text,
      created_by       text not null,
      created_at       timestamptz not null default now(),
      /*
       * Archived, not deleted, and reversible. Deleting a channel deletes the conversation in it, which for a
       * product claiming a year-old decision can be audited is the wrong default.
       */
      archived_at      timestamptz,
      /*
       * Each kind carries exactly what it needs, enforced here rather than trusted.
       *
       * Without this a channel with a null slug is storable and unaddressable, and a decision thread with a
       * null subject_id is storable and unreachable — both of which fail much later, when something tries to
       * build a URL or find the thread for a decision.
       */
      constraint rooms_kind_shape check (
        (kind = 'channel' and slug is not null and subject_id is null) or
        (kind = 'decision' and subject_id is not null and slug is null)
      )
    )
  `

  /*
   * One channel per slug per organization. PARTIAL, because decision threads have no slug and several nulls
   * are not a conflict in Postgres anyway — being explicit says which rows the rule is about.
   */
  yield* sql`
    create unique index if not exists rooms_org_slug_idx
      on rooms (organization_id, slug) where kind = 'channel'
  `

  /*
   * One thread per decision per organization, and this one is load-bearing rather than tidy: the thread is
   * created lazily on the first message, so two people posting at the same moment both find nothing and both
   * insert. The constraint is what makes that a conflict to recover from instead of two threads that each hold
   * half the conversation.
   */
  yield* sql`
    create unique index if not exists rooms_org_subject_idx
      on rooms (organization_id, subject_id) where kind = 'decision'
  `

  /* The channel list: one organization's channels, newest last. Archived rows are filtered in the query. */
  yield* sql`
    create index if not exists rooms_org_kind_idx on rooms (organization_id, kind, id)
  `
})
