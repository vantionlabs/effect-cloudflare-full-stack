/**
 * `assistant_conversations` — the INDEX of a person's conversations (migration 0035).
 *
 * The conversation itself lives in its Durable Object (ADR-0025), and a Durable Object cannot list its siblings —
 * so "which conversations do I have" needs a row somewhere. ADR-0019 keeps the database out of Durable Objects,
 * so the WORKER writes this row after every ask, in the use case, through `Db`. It holds nothing an answer depends
 * on: a title, a count and two times, enough to draw a list and nothing more.
 *
 * `archived_at` rather than delete: tidying the list is not erasing the questions, which stay in the agent.
 */
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export const ConversationTable = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    create table if not exists assistant_conversations (
      organization_id  text not null,
      id               text not null,
      user_id          text not null,
      title            text not null check (length(title) between 1 and 120),
      collection       text not null check (collection in ('policy', 'knowledge')),
      turn_count       integer not null default 0 check (turn_count >= 0),
      created_at       timestamptz not null default now(),
      updated_at       timestamptz not null default now(),
      archived_at      timestamptz,
      primary key (organization_id, id)
    )
  `
  yield* sql`
    create index if not exists assistant_conversations_list_idx
      on assistant_conversations (organization_id, user_id, updated_at desc)
      where archived_at is null
  `
})
