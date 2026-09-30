/**
 * Post a message into a room. Writes it, then returns the row everybody else will be shown.
 *
 * **It does not broadcast.** The transport edge does, after this returns, for the same reason
 * `ApproveDecision` does not: this must stay callable from places with no socket — a script, an import, the
 * eval harness — and a use case that announced itself would make "the announcement failed" a possible outcome
 * of "the message was saved". The order matters in the other direction too: nothing is broadcast that is not
 * already durable, so there is no window in which a client has seen a message a reload would lose.
 *
 * **The room is resolved, and a decision's thread is created here on first use.** That is why the payload takes
 * a `RoomRef` rather than a room id: the console opens a decision and wants to post in its thread without
 * first asking whether the thread exists.
 */
import { RoomArchived } from "@ea/modules/realtime/domain/Errors"
import { Message, type MessageId, MessageMention } from "@ea/modules/realtime/domain/Message"
import type { RoomRef } from "@ea/modules/realtime/domain/Room"
import { CurrentUser, UserId } from "@ea/modules/shared/domain/Identity"
import { Ids } from "@ea/modules/shared/domain/Ids"
import { Db, textArray } from "@ea/modules/shared/tables/Database"
import { Effect } from "effect"
import { ResolveMentions } from "../Mention/ResolveMentions.ts"
import { ResolveRoomOrFail } from "../Room/ResolveRoom.ts"

export const PostMessage = (input: {
  readonly room: RoomRef
  readonly body: string
}) =>
  Effect.gen(function*() {
    const db = yield* Db
    const ids = yield* Ids
    const identity = yield* CurrentUser

    const room = yield* ResolveRoomOrFail(input.room)
    /*
     * An archived channel takes no new messages, and that is the whole difference between archiving and
     * hiding: everything in it stays readable, but the conversation is over. Refused as a typed error because a
     * caller can act on it — un-archive, or post somewhere else.
     */
    if (room.archivedAt !== null) return yield* Effect.fail(new RoomArchived({ roomId: room.id }))

    const id = yield* ids.next
    const rows = yield* db.scoped((sql, orgId) =>
      sql<{ id: string; created_at: Date }>`
        insert into messages (id, organization_id, room_id, author_user_id, body)
        values (${id}, ${orgId}, ${room.id}, ${identity.userId}, ${input.body})
        returning id, created_at
      `
    )

    const row = rows[0]
    if (row === undefined) {
      /*
       * An insert with `returning` that yields nothing is not a domain failure — there is no condition under
       * which this row is legitimately rejected — so it is a defect rather than a typed error.
       */
      return yield* Effect.die(new Error("insert into messages returned no row"))
    }

    /*
     * Mentions are resolved and recorded AFTER the message exists, and a failure here does not lose the message —
     * the insert is already committed. That ordering is deliberate: a message that could not be saved because
     * somebody's handle was ambiguous would be the wrong trade, and an unrecorded mention costs a notification.
     */
    const mentioned = yield* ResolveMentions(input.body)
    if (mentioned.length > 0) {
      yield* db.scoped((sql, orgId) =>
        sql`
          insert into message_mentions (organization_id, message_id, user_id)
          select ${orgId}, ${id}, unnest(${textArray(sql, mentioned.map((person) => person.id))})
          on conflict do nothing
        `
      )
    }

    return new Message({
      id: row.id as MessageId,
      roomId: room.id,
      authorUserId: identity.userId,
      /*
       * The author's own email, from the session, rather than a second query to join it back. It is the same
       * value the join would return — the session was resolved from that row moments ago — and a round trip to
       * learn what we already know would be pure cost on the hottest path in a chat.
       */
      authorEmail: identity.email,
      body: input.body,
      createdAt: row.created_at.toISOString(),
      // A message is never born edited, deleted or reacted to, so these are known rather than read back.
      editedAt: null,
      deletedAt: null,
      reactions: [],
      mentions: mentioned.map((person) => new MessageMention({ userId: UserId.make(person.id), email: person.email }))
    })
  })
