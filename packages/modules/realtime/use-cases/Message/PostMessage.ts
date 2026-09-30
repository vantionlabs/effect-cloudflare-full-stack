/**
 * Post a message. Writes it, then returns the row that everybody else will be shown.
 *
 * **It does not broadcast.** The transport edge does that, after this returns, for the same reason
 * `ApproveDecision` does not: this use case also has to be callable from places with no socket — a script, an
 * import, the eval harness — and a use case that announced itself would make "the announcement failed" a
 * possible outcome of "the message was saved". The order matters in the other direction too: nothing is
 * broadcast that is not already durable, so there is no window in which a client has seen a message a reload
 * would lose.
 *
 * **The subject is not checked to exist, and that is safe rather than lazy.** The row is written with the
 * organization from the session, and every read is scoped the same way, so a caller passing another
 * organization's decision id creates a thread inside *their own* tenant pointing at an id they cannot see —
 * junk, not a leak. Checking would mean reading the `decisions` table from this slice, which is the
 * cross-slice reach `dep:check` exists to prevent. What it costs is a thread on a decision that does not
 * exist; what it buys is that `realtime` knows nothing about `decision`.
 */
import { Message, type MessageId, MessageSubject, type SubjectKind } from "@ea/modules/realtime/domain/Message"
import { CurrentUser } from "@ea/modules/shared/domain/Identity"
import { Ids } from "@ea/modules/shared/domain/Ids"
import { Db } from "@ea/modules/shared/tables/Database"
import { Effect } from "effect"

export const PostMessage = (input: {
  readonly subjectKind: SubjectKind
  readonly subjectId: string
  readonly body: string
}) =>
  Effect.gen(function*() {
    const db = yield* Db
    const ids = yield* Ids
    const identity = yield* CurrentUser
    const id = yield* ids.next

    const rows = yield* db.scoped((sql, orgId) =>
      sql<{ id: string; created_at: Date }>`
        insert into messages (id, organization_id, subject_kind, subject_id, author_user_id, body)
        values (
          ${id}, ${orgId}, ${input.subjectKind}, ${input.subjectId}, ${identity.userId}, ${input.body}
        )
        returning id, created_at
      `
    )

    const row = rows[0]
    if (row === undefined) {
      /*
       * An insert with `returning` that yields nothing is not a domain failure — there is no condition under
       * which this row is legitimately rejected — so it is a defect rather than a typed error. A caller cannot
       * act on it differently from any other 500.
       */
      return yield* Effect.die(new Error("insert into messages returned no row"))
    }

    return new Message({
      id: row.id as MessageId,
      subject: new MessageSubject({ kind: input.subjectKind, id: input.subjectId }),
      authorUserId: identity.userId,
      /*
       * The author's own email, from the session, rather than a second query to join it back.
       *
       * It is the same value the join would return — the session was resolved from that row moments ago — and
       * a round trip to learn what we already know would be pure cost on the hottest path in a chat.
       */
      authorEmail: identity.email,
      body: input.body,
      createdAt: row.created_at.toISOString()
    })
  })
