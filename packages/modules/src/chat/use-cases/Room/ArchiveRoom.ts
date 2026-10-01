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
import { Db } from "@ea/database/Database"
import { RoomNotFound } from "@ea/modules/chat/domain/Errors"
import type { RoomId } from "@ea/modules/chat/domain/Room"
import { Effect } from "effect"
import { ROOM_COLUMNS, toRoom } from "./ResolveRoom.ts"

export const ArchiveRoom = (input: {
  readonly roomId: RoomId
  readonly archived: boolean
}) =>
  Effect.gen(function*() {
    const db = yield* Db
    const rows = yield* db.scoped((sql, orgId) =>
      /*
       * `case when` rather than a NESTED `sql` fragment, and the reason is the tenancy check.
       *
       * This was `set archived_at = ${...? sql`now()` : sql`null`}`, which is correct SQL and unreadable to
       * `scripts/boundaries.ts`: its scanner captures a statement body with `[^`]*`, so a nested template ends
       * the match early — the body it saw stopped before `where organization_id`, and it reported this
       * statement as unscoped. A false positive is the *good* outcome there; the same truncation on a statement
       * that genuinely lacked a tenant filter would have hidden it.
       *
       * So the statement is written as one template. `now()` stays, because the archive time should be the
       * database's clock and not a Worker's.
       */
      sql<never>`
        update rooms
           set archived_at = case when ${input.archived} then now() else null end
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
    return row === undefined ? yield* new RoomNotFound({ roomId: input.roomId }) : toRoom(row)
  })
