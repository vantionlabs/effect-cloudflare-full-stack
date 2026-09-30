/**
 * The organization's channels.
 *
 * Channels only, and archived ones excluded — a channel list is a place to go, and an archived channel is not
 * one. Its messages remain readable by id, which is the difference between archiving and deleting.
 *
 * Decision threads are deliberately absent: there is one per decision, they are reached through the decision,
 * and listing them here would make this endpoint grow with the queue rather than with the channel list.
 */
import { Db } from "@ea/modules/shared/tables/Database"
import { Effect } from "effect"
import { ROOM_COLUMNS, toRoom } from "./ResolveRoom.ts"

export const ListRooms = () =>
  Effect.gen(function*() {
    const db = yield* Db
    const rows = yield* db.scoped((sql, orgId) =>
      sql<never>`
        select ${sql.literal(ROOM_COLUMNS)} from rooms
         where organization_id = ${orgId} and kind = 'channel' and archived_at is null
         order by name asc
      `
    )
    return rows.map(toRoom)
  })
