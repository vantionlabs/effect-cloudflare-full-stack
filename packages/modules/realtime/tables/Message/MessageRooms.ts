/**
 * The one-time move of `messages` from a subject to a room.
 *
 * **Its own file rather than a re-application of `MessageTable.ts`**, and the distinction is worth stating
 * because the repo does both. `0015_rule_conditions` re-applies `RuleTable` because its change is an
 * idempotent *superset* — `add column if not exists` — so one authoritative definition still describes the
 * table. This change is a *transition*: it backfills from columns it then drops, so re-applying the original
 * definition afterwards would be wrong, and folding it into that file would leave a `create table` that
 * describes a shape no database ever has.
 *
 * It also has to run AFTER `rooms` exists, which is why the ordering in `Migrations.ts` is explicit and why
 * this cannot live in the file that runs at `0016`.
 *
 * Safe to re-run: every step is guarded, and the backfill only touches rows that still have no room.
 */
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export const MessageRooms = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  yield* sql`alter table messages add column if not exists room_id text`

  /*
   * A room for every distinct thread that already has messages.
   *
   * `gen_random_uuid()` rather than the `Ids` port, because a migration has no access to application services
   * and these ids are for rows that already exist — nothing sorts by them. Every message table elsewhere uses
   * UUIDv7 from the port; this is the one place that cannot, and it does not matter here.
   *
   * `on conflict do nothing` against the partial unique index, so a partially-applied run resumes cleanly.
   */
  yield* sql`
    insert into rooms (id, organization_id, kind, name, subject_id, created_by, created_at)
    select gen_random_uuid()::text,
           m.organization_id,
           'decision',
           'Decision thread',
           m.subject_id,
           /*
            * The earliest author becomes the creator. Not strictly true — nobody created these rooms, they are
            * being invented now — but it is the most useful lie available: the alternative is a sentinel that
            * every reader has to learn about.
            */
           (array_agg(m.author_user_id order by m.id))[1],
           min(m.created_at)
      from messages m
     where m.room_id is null and m.subject_kind = 'decision'
     group by m.organization_id, m.subject_id
    on conflict do nothing
  `

  /*
   * The tenant-wide channel, for any messages that were posted to it before channels existed. It gets a slug
   * because it becomes an ordinary channel — which is the point of the move: what was a special case is now a
   * row like any other.
   */
  yield* sql`
    insert into rooms (id, organization_id, kind, name, slug, created_by, created_at)
    select gen_random_uuid()::text,
           m.organization_id,
           'channel',
           'General',
           'general',
           (array_agg(m.author_user_id order by m.id))[1],
           min(m.created_at)
      from messages m
     where m.room_id is null and m.subject_kind = 'organization'
     group by m.organization_id
    on conflict do nothing
  `

  yield* sql`
    update messages m
       set room_id = r.id
      from rooms r
     where m.room_id is null
       and r.organization_id = m.organization_id
       and ((m.subject_kind = 'decision' and r.kind = 'decision' and r.subject_id = m.subject_id)
         or (m.subject_kind = 'organization' and r.kind = 'channel' and r.slug = 'general'))
  `

  /*
   * The constraint and the FK come after the backfill, in that order, so a database with existing rows is
   * migrated rather than rejected. `on delete cascade`: deleting a room is not something the product does —
   * archiving is — but if one is ever removed by hand, orphaned messages would be unreadable and unreachable.
   */
  yield* sql`alter table messages alter column room_id set not null`
  yield* sql`
    do $$
    begin
      if not exists (
        select 1 from pg_constraint where conname = 'messages_room_id_fkey'
      ) then
        alter table messages
          add constraint messages_room_id_fkey
          foreign key (room_id) references rooms(id) on delete cascade;
      end if;
    end $$
  `

  /*
   * The old columns go, rather than staying as a second way to identify a thread.
   *
   * Keeping them would mean every query choosing which to trust, and the two drifting the first time a room is
   * renamed or a message is moved. The index that served them goes with them.
   */
  yield* sql`drop index if exists messages_thread_idx`
  yield* sql`alter table messages drop column if exists subject_kind`
  yield* sql`alter table messages drop column if exists subject_id`

  /* The thread read, now by room. `id` last so one index serves the ordering and the keyset cursor. */
  yield* sql`
    create index if not exists messages_room_idx on messages (organization_id, room_id, id)
  `
})
