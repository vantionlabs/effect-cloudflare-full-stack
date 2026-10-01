/**
 * Record how far somebody has read in a room.
 *
 * **Idempotent and monotonic**, both of which matter for a client that calls this on every render of a thread: an
 * upsert means no read-then-write, and `greatest` means a client that happens to send an older id — scrolled up,
 * or a late response arriving after a newer one — cannot move the marker backwards and re-unread what was already
 * seen.
 *
 * `greatest` over TEXT works because ids are UUIDv7 in hex, which sorts lexicographically in time order. That is
 * the same property the thread's keyset cursor relies on, and it is worth stating twice: if ids ever stop being
 * time-ordered, both quietly break.
 */
import { Db } from "@ea/database/Database"
import { CurrentUser } from "@ea/domain/Identity"
import { RoomNotFound } from "@ea/modules/chat/domain/Errors"
import { MessageId } from "@ea/modules/chat/domain/Message"
import type { RoomId } from "@ea/modules/chat/domain/Room"
import { Effect } from "effect"

export const MarkRead = (input: {
  readonly roomId: RoomId
  readonly messageId: MessageId
}) =>
  Effect.gen(function*() {
    const db = yield* Db
    const identity = yield* CurrentUser

    /*
     * The room is checked so that a marker cannot be written for a room the caller cannot see — the FK would
     * otherwise reject it as a constraint violation, which is a 500 for what is really "not yours".
     */
    const rooms = yield* db.scoped((sql, orgId) =>
      sql<{ id: string }>`select id from rooms where organization_id = ${orgId} and id = ${input.roomId}`
    )
    if (rooms[0] === undefined) return yield* new RoomNotFound({ roomId: input.roomId })

    const rows = yield* db.scoped((sql, orgId) =>
      sql<{ last_read_message_id: string }>`
        insert into room_reads (organization_id, room_id, user_id, last_read_message_id)
        values (${orgId}, ${input.roomId}, ${identity.userId}, ${input.messageId})
        on conflict (room_id, user_id) do update
           set last_read_message_id = greatest(room_reads.last_read_message_id, excluded.last_read_message_id),
               updated_at = now()
        returning last_read_message_id
      `
    )

    /*
     * The marker as it now STANDS, which may be a later message than the one just sent — `greatest` kept the
     * existing value. Returning what the caller sent instead would tell them their older id had won.
     */
    const current = rows[0]?.last_read_message_id
    return {
      roomId: input.roomId,
      lastReadMessageId: current === undefined ? input.messageId : MessageId.make(current)
    }
  })
