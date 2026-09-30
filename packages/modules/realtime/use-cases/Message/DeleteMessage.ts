/**
 * Remove what you said. Author only, and the content really goes.
 *
 * The row stays: who spoke, when, and that they removed it. The body is replaced, so "delete" means what a user
 * expects it to mean rather than hiding content the database still holds — see `MessageTable.ts` for the tension
 * and why it resolves this way.
 *
 * Idempotent: deleting an already-deleted message succeeds and changes nothing. Double-clicking a delete button
 * is not an error, and the second click must not tell the user something went wrong.
 */
import { Db } from "@ea/database/Database"
import { CurrentUser } from "@ea/domain/Identity"
import { MessageNotFound, NotMessageAuthor } from "@ea/modules/realtime/domain/Errors"
import { type MessageId } from "@ea/modules/realtime/domain/Message"
import { Effect } from "effect"

/**
 * What replaces the body.
 *
 * A sentinel rather than an empty string, because the column's CHECK requires a non-empty body — and that
 * constraint is worth keeping for every other write. A client should branch on `deletedAt`, not match this text.
 */
export const DELETED_BODY = "[deleted]"

export const DeleteMessage = (input: { readonly messageId: MessageId }) =>
  Effect.gen(function*() {
    const db = yield* Db
    const identity = yield* CurrentUser

    const found = yield* db.scoped((sql, orgId) =>
      sql<{ author_user_id: string; deleted_at: Date | null }>`
        select author_user_id, deleted_at from messages
         where organization_id = ${orgId} and id = ${input.messageId}
      `
    )

    const existing = found[0]
    if (existing === undefined) return yield* Effect.fail(new MessageNotFound({ messageId: input.messageId }))
    if (existing.author_user_id !== identity.userId) {
      return yield* Effect.fail(new NotMessageAuthor({ messageId: input.messageId }))
    }
    // Already gone. Nothing to do, and nothing to complain about.
    if (existing.deleted_at !== null) return { messageId: input.messageId }

    yield* db.scoped((sql, orgId) =>
      sql`
        update messages set body = ${DELETED_BODY}, deleted_at = now()
         where organization_id = ${orgId} and id = ${input.messageId}
      `
    )

    return { messageId: input.messageId }
  })
