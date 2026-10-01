/**
 * Change what you said. Author only.
 *
 * **`edited_at` is recorded and surfaced**, rather than the edit being invisible. In a thread attached to a
 * decision, an edited note and an original are not the same evidence, and a reader who cannot tell them apart is
 * worse off than one who sees "edited" next to it. This is the same instinct as `retrieval_mode` on a decision:
 * the conditions a record was made under are part of the record.
 *
 * The previous text is NOT kept. A revision history is a real feature with its own table and its own reason to
 * exist; storing the old body in a column nobody reads would be the shape of one without the substance.
 */
import { Db, textArray } from "@ea/database/Database"
import { CurrentUser } from "@ea/domain/Identity"
import { MessageNotFound, NotMessageAuthor } from "@ea/modules/chat/domain/Errors"
import { type MessageId } from "@ea/modules/chat/domain/Message"
import { Effect } from "effect"
import { ResolveMentions } from "../Mention/ResolveMentions.ts"

export const EditMessage = (input: {
  readonly messageId: MessageId
  readonly body: string
}) =>
  Effect.gen(function*() {
    const db = yield* Db
    const identity = yield* CurrentUser

    /*
     * Read first, so the two refusals can be told apart: a message that is not here at all, versus one that is
     * somebody else's. A single `update ... where author = me` would collapse them into "nothing happened",
     * which tells a user nothing about which of the two it was.
     */
    const found = yield* db.scoped((sql, orgId) =>
      sql<{ author_user_id: string; deleted_at: Date | null }>`
        select author_user_id, deleted_at from messages
         where organization_id = ${orgId} and id = ${input.messageId}
      `
    )

    const existing = found[0]
    if (existing === undefined) return yield* new MessageNotFound({ messageId: input.messageId })
    if (existing.author_user_id !== identity.userId) {
      return yield* new NotMessageAuthor({ messageId: input.messageId })
    }
    /*
     * A deleted message cannot be edited back into existence. Reported as "not found", because from the
     * author's point of view it is gone — and because the alternative would let somebody restore content they
     * had removed, which is the opposite of what deleting promised.
     */
    if (existing.deleted_at !== null) {
      return yield* new MessageNotFound({ messageId: input.messageId })
    }

    const updated = yield* db.scoped((sql, orgId) =>
      sql<{ edited_at: Date }>`
        update messages set body = ${input.body}, edited_at = now()
         where organization_id = ${orgId} and id = ${input.messageId}
        returning edited_at
      `
    )

    /*
     * Mentions are RE-resolved, not merged: editing "@alice" to "@bob" must stop mentioning Alice. Delete then
     * insert, which is also how a removed mention disappears — a merge would only ever add.
     */
    yield* db.scoped((sql, orgId) =>
      sql`delete from message_mentions where organization_id = ${orgId} and message_id = ${input.messageId}`
    )
    const mentioned = yield* ResolveMentions(input.body)
    if (mentioned.length > 0) {
      yield* db.scoped((sql, orgId) =>
        sql`
          insert into message_mentions (organization_id, message_id, user_id)
          select ${orgId}, ${input.messageId}, unnest(${textArray(sql, mentioned.map((person) => person.id))})
          on conflict do nothing
        `
      )
    }

    const row = updated[0]
    return row === undefined
      // Present a moment ago and gone now: a race, not a domain condition, so a defect rather than an error.
      ? yield* Effect.die(new Error("message disappeared between the read and the update"))
      : { messageId: input.messageId, editedAt: row.edited_at.toISOString() }
  })
