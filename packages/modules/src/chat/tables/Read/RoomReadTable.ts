/**
 * `room_reads`: how far each person has read in each room.
 *
 * One row per (room, person), holding the id of the last message they have seen. Unread is then a COUNT rather
 * than a stored number, which is the whole reason this table is two columns wide: a counter would have to be
 * incremented for every member on every post — a write per reader per message, and a number that drifts the
 * first time one of those writes is lost.
 *
 * **The marker only ever moves forward, and that relies on ids being lexicographically ordered.** UUIDv7 in hex
 * sorts the same way it sorts by time, so `greatest(existing, incoming)` as TEXT is "the later message". Without
 * that, a client that scrolled back and marked an old message read would reset the marker and re-unread
 * everything after it.
 */
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export const RoomReadTable = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    create table if not exists room_reads (
      -- No FK to better-auth's organization table; see TenancyTable.ts.
      organization_id       text not null,
      room_id               text not null references rooms(id) on delete cascade,
      user_id               text not null,
      /*
       * The last message this person has seen. No FK: a marker must survive the message it points at being
       * deleted, and a delete here REDACTS rather than removes, so the row normally stays anyway — but a hard
       * delete by hand must not take somebody's read position with it.
       */
      last_read_message_id  text not null,
      updated_at            timestamptz not null default now(),
      primary key (room_id, user_id)
    )
  `

  /* Reading everybody's position in one organization, which is what the room list needs. */
  yield* sql`
    create index if not exists room_reads_user_idx on room_reads (organization_id, user_id)
  `
})
