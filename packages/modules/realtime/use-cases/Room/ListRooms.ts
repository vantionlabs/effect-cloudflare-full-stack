/**
 * The organization's channels, with how much each reader has not seen.
 *
 * Channels only, and archived ones excluded — a channel list is a place to go, and an archived channel is not one.
 * Its messages remain readable by id, which is the difference between archiving and deleting.
 *
 * Decision threads are deliberately absent: there is one per decision, they are reached through the decision, and
 * listing them here would make this endpoint grow with the queue rather than with the channel list.
 *
 * **Unread is COUNTED, not stored.** A stored counter would need incrementing for every member on every post — a
 * write per reader per message — and would drift the first time one of those writes was lost. The count here is a
 * correlated subquery over an index, and a channel list is short by nature; when it is not, the fix is a
 * materialised count with a documented staleness, not a counter maintained by hand.
 */
import { CurrentUser } from "@ea/domain/Identity"
import { Db } from "@ea/modules/shared/tables/Database"
import { Effect } from "effect"
import { ROOM_COLUMNS, toRoom } from "./ResolveRoom.ts"

export const ListRooms = () =>
  Effect.gen(function*() {
    const db = yield* Db
    const identity = yield* CurrentUser

    const rows = yield* db.scoped((sql, orgId) =>
      sql<never>`
        select ${sql.literal(ROOM_COLUMNS.split(", ").map((column) => `r.${column}`).join(", "))},
               (
                 select count(*)::int
                   from messages m
                  where m.organization_id = r.organization_id
                    and m.room_id = r.id
                    -- You have read what you wrote, so your own messages never count as unread.
                    and m.author_user_id <> ${identity.userId}
                    and (rd.last_read_message_id is null or m.id > rd.last_read_message_id)
               ) as unread_count
          from rooms r
          -- LEFT, because somebody who has never opened a channel has read none of it rather than all of it.
          left join room_reads rd on rd.room_id = r.id and rd.user_id = ${identity.userId}
         where r.organization_id = ${orgId} and r.kind = 'channel' and r.archived_at is null
         order by r.name asc
      `
    )

    return rows.map((row) => toRoom(row, (row as { readonly unread_count: number }).unread_count))
  })
