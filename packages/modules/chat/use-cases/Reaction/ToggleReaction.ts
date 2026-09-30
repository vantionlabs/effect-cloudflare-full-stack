/**
 * React, or take a reaction back. One operation, because to a user it is one button.
 *
 * **Toggling is an insert that may conflict, then a delete.** The primary key `(message_id, user_id, emoji)` makes
 * the insert idempotent, so the *number of rows inserted* is the answer to "was it already there" — no read
 * needed, and no window between deciding and acting in which somebody else's click changes the answer.
 *
 * It returns what the reaction now IS rather than what it was, because that is what a caller renders.
 */
import { Db } from "@ea/database/Database"
import { CurrentUser } from "@ea/domain/Identity"
import { MessageNotFound } from "@ea/modules/chat/domain/Errors"
import type { MessageId } from "@ea/modules/chat/domain/Message"
import { Effect } from "effect"

export const ToggleReaction = (input: {
  readonly messageId: MessageId
  readonly emoji: string
}) =>
  Effect.gen(function*() {
    const db = yield* Db
    const identity = yield* CurrentUser

    /*
     * The message is checked first, and not only for a good error: the reaction row has a foreign key, so
     * inserting against a missing message would fail as a constraint violation — a 500 for what is really "that
     * message is gone". Scoped, so another tenant's message is simply not found.
     */
    const found = yield* db.scoped((sql, orgId) =>
      sql<{ id: string }>`
        select id from messages where organization_id = ${orgId} and id = ${input.messageId}
      `
    )
    if (found[0] === undefined) return yield* Effect.fail(new MessageNotFound({ messageId: input.messageId }))

    const inserted = yield* db.scoped((sql, orgId) =>
      sql<{ message_id: string }>`
        insert into message_reactions (organization_id, message_id, user_id, emoji)
        values (${orgId}, ${input.messageId}, ${identity.userId}, ${input.emoji})
        on conflict do nothing
        returning message_id
      `
    )

    // A row went in, so this is a new reaction and there is nothing else to do.
    if (inserted[0] !== undefined) return { messageId: input.messageId, emoji: input.emoji, reacted: true }

    /*
     * It was already there, so the click means "take it back". Delete on the same key — which is also why this
     * cannot double-remove somebody else's reaction: `user_id` is part of it.
     */
    yield* db.scoped((sql, orgId) =>
      sql`
        delete from message_reactions
         where organization_id = ${orgId}
           and message_id = ${input.messageId}
           and user_id = ${identity.userId}
           and emoji = ${input.emoji}
      `
    )
    return { messageId: input.messageId, emoji: input.emoji, reacted: false }
  })
