/**
 * `extractions`: what a model read out of a document, and whether we believed it.
 *
 * The row stores the extraction **and the parsed text it was checked against**. That is deliberate
 * duplication of the document bytes, and it is the point: `source_span` verification is only
 * re-checkable a year later if the exact text the check originally ran on is still available. A
 * parser upgrade changes what a span matches, so keeping only the document would silently change the
 * meaning of a stored verdict.
 *
 * `unverified_fields` and `arithmetic_failures` are stored as arrays rather than a boolean. A
 * reviewer needs to know *which* field failed, and an eval run needs to count failures by field to
 * tell a retrieval problem from a schema problem.
 */
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export const ExtractionTable = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    create table if not exists extractions (
      id                   text primary key,
      -- No FK to better-auth's organization table; see Tenancy.table.ts.
      organization_id      text not null,
      document_id          text not null references source_documents(id) on delete cascade,
      -- Which vertical's schema produced this. Not a CHECK constraint: a stored extraction from a
      -- vertical this build no longer has must still be readable, which is a migration concern
      -- rather than a validation one.
      vertical             text not null,
      -- The typed fields, each with its source_span. Postgres does not preserve jsonb key order, so
      -- the detail screen re-imposes the schema's own order when it renders this.
      fields               jsonb not null,
      -- The text every span was checked against. See the note above on why this is stored.
      document_text        text not null,
      -- The parser and model that produced it. A parser version defines the verbatim contract, so
      -- without these a stored verdict cannot be reproduced.
      parser_version       text not null,
      model                text not null,
      -- Dotted paths, e.g. {line_items.2.amount}. Empty means every span verified.
      unverified_fields    text[] not null default '{}',
      -- Human-readable, each naming the sum that disagreed.
      arithmetic_failures  text[] not null default '{}',
      created_at           timestamptz not null default now()
    )
  `

  yield* sql`
    create index if not exists extractions_org_document_idx
      on extractions (organization_id, document_id)
  `
})
