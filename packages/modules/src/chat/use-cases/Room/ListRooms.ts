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
import { Db } from "@ea/database/Database"
import { CurrentUser } from "@ea/domain/Identity"
import { clampPageSize } from "@ea/modules/shared/domain/Page"
import { Effect } from "effect"
import { ROOM_COLUMNS, toRoom } from "./ResolveRoom.ts"

/**
 * Takes a page, where it used to return everything.
 *
 * An organization has few channels, so this is not a performance fix — it is that an unbounded query has no
 * worst case, and the subselect per row counts unread messages, so the cost grows with channels times
 * messages. A REST collection has to state a bound anyway; stating it here means the RPC caller gets the same
 * one rather than a different one.
 */
export const ListRooms = (input: {
  readonly limit?: number | undefined
  /** The keyset from a previous page: the last row's name and id, in that order. */
  readonly after?: readonly [name: string, roomId: string] | undefined
} = {}) =>
  Effect.gen(function*() {
    const db = yield* Db
    const identity = yield* CurrentUser
    const limit = clampPageSize(input.limit)

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
           ${
        input.after === undefined
          ? sql``
          // Keyed on the SORT columns, which here are a name and an id rather than a timestamp: paging must follow
          // the order the query actually returns, not the order the ids happen to be in.
          : sql`and (r.name, r.id) > (${input.after[0]}, ${input.after[1]})`
      }
         order by r.name asc, r.id asc
         limit ${limit}
      `
    )

    return rows.map((row) => toRoom(row, (row as { readonly unread_count: number }).unread_count))
  })
