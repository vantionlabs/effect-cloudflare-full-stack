/**
 * Archive or restore a channel.
 *
 * **Not a delete, and reversible.** Deleting a channel deletes the conversation in it; for a product whose
 * claim is that a year-old decision can be audited, losing the argument about it is the wrong default. An
 * archived channel disappears from the list and takes no new messages; everything in it stays readable.
 *
 * One operation with a flag rather than `archive` and `restore`, because the two differ only in which
 * timestamp is written and a caller toggling a switch should not have to pick a method name.
 */
import { RoomNotFound } from "@ea/modules/realtime/domain/Errors"
import type { RoomId } from "@ea/modules/realtime/domain/Room"
import { Db } from "@ea/modules/shared/tables/Database"
import { Effect } from "effect"
import { ROOM_COLUMNS, toRoom } from "./ResolveRoom.ts"

export const ArchiveRoom = (input: {
  readonly roomId: RoomId
  readonly archived: boolean
}) =>
  Effect.gen(function*() {
    const db = yield* Db
    const rows = yield* db.scoped((sql, orgId) =>
      sql<never>`
        update rooms
           set archived_at = ${input.archived ? sql`now()` : sql`null`}
         where organization_id = ${orgId} and id = ${input.roomId} and kind = 'channel'
        returning ${sql.literal(ROOM_COLUMNS)}
      `
    )

    const row = rows[0]
    /*
     * The same refusal whether the room is missing, belongs to another tenant, or is a decision thread. A
     * decision thread has no archive state — it exists exactly as long as its decision is discussed — and
     * saying so separately would tell a caller which ids are threads.
     */
    return row === undefined ? yield* Effect.fail(new RoomNotFound({ roomId: input.roomId })) : toRoom(row)
  })
