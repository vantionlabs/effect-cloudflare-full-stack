/**
 * A room's messages, oldest first, optionally after a cursor.
 *
 * **One query shape serves three jobs**: the first page, the next page, and a reconnecting client's catch-up.
 * That is the point of keyset pagination rather than an offset — an offset shifts under inserts, and a live
 * thread inserts constantly, so paging with one would skip or repeat messages exactly when the feature is
 * working. `after` is a message id, and ids are time-ordered (UUIDv7), so `id >` is chronological.
 *
 * Oldest-first, unlike most feeds: a conversation reads in the order it happened, and a client appending live
 * messages to the end needs the stored ones in the same direction.
 *
 * A room that does not exist yet reads as an EMPTY thread rather than an error. A decision's thread is created
 * by the first message, so "nobody has said anything" and "there is no row" are the same fact to a reader —
 * and `ResolveRoom` is asked not to create one, so reading never writes.
 */
import { CurrentUser, UserId } from "@ea/domain/Identity"
import { Message, type MessageId, MessageMention, MessageReaction } from "@ea/modules/realtime/domain/Message"
import type { RoomId, RoomRef } from "@ea/modules/realtime/domain/Room"
import { Db } from "@ea/modules/shared/tables/Database"
import { Effect } from "effect"
import { ResolveRoom } from "../Room/ResolveRoom.ts"

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50

export const ListMessages = (input: {
  readonly room: RoomRef
  readonly after?: MessageId | undefined
  readonly limit?: number | undefined
}) =>
  Effect.gen(function*() {
    const db = yield* Db
    const identity = yield* CurrentUser
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
    const after = input.after

    const room = yield* ResolveRoom(input.room, { create: false })
    if (room === null) return []

    const rows = yield* db.scoped((sql, orgId) =>
      sql<{
        id: string
        author_user_id: string
        author_email: string | null
        body: string
        created_at: Date
        edited_at: Date | null
        deleted_at: Date | null
      }>`
        select m.id, m.author_user_id, u.email as author_email, m.body, m.created_at,
               m.edited_at, m.deleted_at
          from messages m
          -- A LEFT join into better-auth's own table, read-only. Left, because a deleted user must leave their
          -- messages behind: an audit trail that erases who said something is not one. Our tables carry no
          -- foreign key into better-auth's (TenancyTable.ts), so this is the one place the schemas meet.
          left join "user" u on u.id = m.author_user_id
         where m.organization_id = ${orgId}
           and m.room_id = ${room.id}
           ${after === undefined ? sql`` : sql`and m.id > ${after}`}
         order by m.id asc
         limit ${limit}
      `
    )

    /*
     * Reactions in a SECOND query, not a lateral join.
     *
     * A `left join lateral` aggregating to jsonb would fetch this in one round trip and would put a nested
     * aggregation into the middle of the thread read, where it is the hardest thing on the page to verify. Two
     * indexed queries are easier to read, easier to explain, and the grouping is three lines of TypeScript.
     *
     * Skipped entirely when the page is empty, because `in ()` is not valid SQL.
     */
    const ids = rows.map((row) => row.id)
    const reactionRows = ids.length === 0 ?
      [] :
      yield* db.scoped((sql, orgId) =>
        sql<{ message_id: string; emoji: string; count: number; mine: boolean }>`
        select message_id, emoji, count(*)::int as count, bool_or(user_id = ${identity.userId}) as mine
          from message_reactions
         where organization_id = ${orgId} and ${sql.in("message_id", ids)}
         group by message_id, emoji
         order by emoji asc
      `
      )

    /*
     * Mentions in a third query, for the same reason reactions are in a second: a join per extra dimension turns
     * the thread read into something nobody can verify at a glance, while these are indexed lookups on the same
     * page of ids. Three round trips for a page of messages is the right trade at this size; if it stops being
     * one, the fix is a single aggregating query written deliberately, not one that grew.
     */
    const mentionRows = ids.length === 0 ?
      [] :
      yield* db.scoped((sql, orgId) =>
        sql<{ message_id: string; user_id: string; email: string | null }>`
        select mm.message_id, mm.user_id, u.email
          from message_mentions mm
          -- LEFT, because a mention must survive the person leaving: "ask @alice" is what was said.
          left join "user" u on u.id = mm.user_id
         where mm.organization_id = ${orgId} and ${sql.in("mm.message_id", ids)}
      `
      )

    const mentionsByMessage = new Map<string, Array<MessageMention>>()
    for (const row of mentionRows) {
      const existing = mentionsByMessage.get(row.message_id) ?? []
      existing.push(new MessageMention({ userId: UserId.make(row.user_id), email: row.email }))
      mentionsByMessage.set(row.message_id, existing)
    }

    const reactionsByMessage = new Map<string, Array<MessageReaction>>()
    for (const row of reactionRows) {
      const existing = reactionsByMessage.get(row.message_id) ?? []
      existing.push(new MessageReaction({ emoji: row.emoji, count: row.count, mine: row.mine }))
      reactionsByMessage.set(row.message_id, existing)
    }

    return rows.map((row) =>
      new Message({
        id: row.id as MessageId,
        roomId: room.id as RoomId,
        authorUserId: UserId.make(row.author_user_id),
        authorEmail: row.author_email,
        body: row.body,
        createdAt: row.created_at.toISOString(),
        editedAt: row.edited_at === null ? null : row.edited_at.toISOString(),
        deletedAt: row.deleted_at === null ? null : row.deleted_at.toISOString(),
        reactions: reactionsByMessage.get(row.id) ?? [],
        mentions: mentionsByMessage.get(row.id) ?? []
      })
    )
  })
