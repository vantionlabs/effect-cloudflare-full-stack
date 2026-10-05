/**
 * The index of a person's conversations: written by the Worker after every ask, read to draw the list.
 *
 * In the use case and through `Db`, never in the agent — ADR-0019 keeps the database out of Durable Objects. The
 * index holds nothing an answer depends on, so a failed write loses a list line, never an answer: it is attempted
 * after the turn is recorded, and its failure is logged rather than raised.
 */
import { Db } from "@ea/database/Database"
import { CurrentUser } from "@ea/domain/Identity"
import { AssistantConversations, ConversationSummary, conversationTitle } from "@ea/modules/policy/domain/Assistant"
import type { AskableCollection } from "@ea/modules/shared/domain/Corpus"
import { Effect } from "effect"
import { AskInConversation } from "./AskInConversation.ts"

interface SummaryRow {
  id: string
  title: string
  collection: AskableCollection
  turn_count: number
  updated_at: Date
}

const toSummary = (row: SummaryRow) =>
  new ConversationSummary({
    id: row.id,
    title: row.title,
    collection: row.collection,
    turnCount: row.turn_count,
    updatedAt: row.updated_at.toISOString()
  })

/** Upserts the caller's index row. The title is set once, from the first question, and kept after a rename. */
export const touchConversation = (
  conversationId: string,
  firstQuestion: string,
  collection: AskableCollection,
  turnCount: number
) =>
  Effect.gen(function*() {
    const db = yield* Db
    const user = yield* CurrentUser
    yield* db.scoped((sql, orgId) =>
      sql`
        insert into assistant_conversations (organization_id, id, user_id, title, collection, turn_count)
        values (${orgId}, ${conversationId}, ${user.userId}, ${conversationTitle(firstQuestion)}, ${collection},
                ${turnCount})
        on conflict (organization_id, id) do update
          set turn_count = excluded.turn_count, updated_at = now(), archived_at = null
      `
    )
  }).pipe(
    Effect.catch((failure) => Effect.logWarning(`conversation index not updated: ${failure._tag}`))
  )

/** The caller's own, unarchived conversations in the active organization, newest first. */
export const ListConversations = Effect.gen(function*() {
  const db = yield* Db
  const user = yield* CurrentUser
  return yield* db.scoped((sql, orgId) =>
    Effect.map(
      sql<SummaryRow>`
        select id, title, collection, turn_count, updated_at from assistant_conversations
         where organization_id = ${orgId} and user_id = ${user.userId} and archived_at is null
         order by updated_at desc
         limit 50
      `,
      (rows) => rows.map(toSummary)
    )
  )
})

export const RenameConversation = (conversationId: string, title: string) =>
  Effect.gen(function*() {
    const db = yield* Db
    const user = yield* CurrentUser
    const trimmed = conversationTitle(title)
    yield* db.scoped((sql, orgId) =>
      sql`
        update assistant_conversations set title = ${trimmed}
         where organization_id = ${orgId} and id = ${conversationId} and user_id = ${user.userId}
      `
    )
    return yield* ListConversations
  })

export const ArchiveConversation = (conversationId: string) =>
  Effect.gen(function*() {
    const db = yield* Db
    const user = yield* CurrentUser
    yield* db.scoped((sql, orgId) =>
      sql`
        update assistant_conversations set archived_at = now()
         where organization_id = ${orgId} and id = ${conversationId} and user_id = ${user.userId}
      `
    )
    return yield* ListConversations
  })

/**
 * `AskInConversation`, then the index row — after an answer AND after a refusal, because a refused question is still
 * a conversation the person had. The row's title is the conversation's FIRST question, read from the agent.
 */
export const AskAndIndex = (conversationId: string, question: string, collection: AskableCollection) =>
  AskInConversation(conversationId, question, collection).pipe(
    Effect.tap((result) =>
      touchConversation(
        conversationId,
        result.conversation.turns[0]?.question ?? question,
        collection,
        result.conversation.turns.length
      )
    ),
    Effect.tapErrorTag(
      "UngroundedAnswer",
      () =>
        Effect.flatMap(AssistantConversations, (conversations) => conversations.history(conversationId)).pipe(
          Effect.flatMap((conversation) =>
            touchConversation(
              conversationId,
              conversation.turns[0]?.question ?? question,
              collection,
              conversation.turns.length
            )
          ),
          // The refusal is what the caller must see; a failure to read the history only costs the list line.
          Effect.catch(() => Effect.void)
        )
    )
  )
