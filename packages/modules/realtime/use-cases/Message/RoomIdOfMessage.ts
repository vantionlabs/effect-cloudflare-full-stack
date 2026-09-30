/**
 * Which room a message is in.
 *
 * Exists for the transport edge, which has to address a broadcast and does not otherwise need the room. Kept out
 * of `EditMessage` and `DeleteMessage` on purpose: their callers include places with no socket, and returning a
 * room id "in case somebody wants to announce it" would put transport's needs into a use case's signature.
 *
 * `null` rather than an error for a message that is not there — the caller has just acted on it, so absence here
 * means a concurrent delete, and there is nobody to tell.
 */
import type { MessageId } from "@ea/modules/realtime/domain/Message"
import { Db } from "@ea/modules/shared/tables/Database"
import { Effect } from "effect"

export const RoomIdOfMessage = (messageId: MessageId) =>
  Effect.gen(function*() {
    const db = yield* Db
    const rows = yield* db.scoped((sql, orgId) =>
      sql<{ room_id: string }>`
        select room_id from messages where organization_id = ${orgId} and id = ${messageId}
      `
    )
    return rows[0]?.room_id ?? null
  })
