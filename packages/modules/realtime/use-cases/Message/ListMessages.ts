/**
 * A thread, oldest first, optionally after a cursor.
 *
 * **One query shape serves three jobs**: the first page, the next page, and a reconnecting client's catch-up.
 * That is the point of keyset pagination here rather than an offset — an offset shifts under inserts, and a
 * live thread inserts constantly, so paging with one would skip or repeat messages exactly when the feature is
 * working. `after` is a message id, and ids are time-ordered (UUIDv7), so `id >` is chronological.
 *
 * Oldest-first, unlike most feeds: a conversation reads in the order it happened, and a client that appends
 * live messages to the end needs the stored ones in the same direction.
 */
import { Message, type MessageId, MessageSubject, type SubjectKind } from "@ea/modules/realtime/domain/Message"
import { UserId } from "@ea/modules/shared/domain/Identity"
import { Db } from "@ea/modules/shared/tables/Database"
import { Effect } from "effect"

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50

export const ListMessages = (input: {
  readonly subjectKind: SubjectKind
  readonly subjectId: string
  readonly after?: MessageId | undefined
  readonly limit?: number | undefined
}) =>
  Effect.gen(function*() {
    const db = yield* Db
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
    const after = input.after

    const rows = yield* db.scoped((sql, orgId) =>
      sql<{
        id: string
        author_user_id: string
        author_email: string | null
        body: string
        created_at: Date
      }>`
        select m.id, m.author_user_id, u.email as author_email, m.body, m.created_at
          from messages m
          /*
           * A LEFT join into better-auth's own table, read-only.
           *
           * Left, because a deleted user must leave their messages behind — an audit trail that erases who
           * said something is not one. Our tables carry no foreign key into better-auth's (TenancyTable.ts),
           * so this is the one place the two schemas meet, and it meets them in a direction that cannot
           * constrain what better-auth does to its own rows.
           */
          left join "user" u on u.id = m.author_user_id
         where m.organization_id = ${orgId}
           and m.subject_kind = ${input.subjectKind}
           and m.subject_id = ${input.subjectId}
           ${after === undefined ? sql`` : sql`and m.id > ${after}`}
         order by m.id asc
         limit ${limit}
      `
    )

    return rows.map((row) =>
      new Message({
        id: row.id as MessageId,
        subject: new MessageSubject({ kind: input.subjectKind, id: input.subjectId }),
        authorUserId: UserId.make(row.author_user_id),
        authorEmail: row.author_email,
        body: row.body,
        createdAt: row.created_at.toISOString()
      })
    )
  })
