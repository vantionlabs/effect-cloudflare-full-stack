/**
 * The review queue, and the detail behind one decision.
 *
 * Ordered oldest-first, which is the opposite of most feeds and is deliberate: a review queue is a backlog,
 * and the oldest item is the one closest to breaching whatever the client was promised. Newest-first would
 * bury the urgent work under the fresh work.
 */
import { Db } from "@ea/database/Database"
import { DecisionDetail, QueueItem } from "@ea/modules/decision/domain/Decision"
import { Effect, Schema } from "effect"

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50

/** Statuses a reviewer can still act on. `approved` and `rejected` are settled and leave the queue. */
const OPEN_STATUSES = ["pending_review", "needs_attention"] as const

export const ListQueue = (input: { readonly limit?: number | undefined }) =>
  Effect.gen(function*() {
    const db = yield* Db
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)

    const rows = yield* db.scoped((sql, orgId) =>
      sql<{
        id: string
        document_id: string
        filename: string
        outcome: string
        status: string
        rails_fired: ReadonlyArray<string>
        retrieval_mode: string
        grounded: boolean
        decided_at: Date
      }>`
        select d.id, d.document_id, s.filename, d.effective_outcome as outcome, d.status,
               d.rails_fired, d.retrieval_mode, d.grounded, d.decided_at
          from decisions d
          join source_documents s on s.id = d.document_id
         where d.organization_id = ${orgId}
           and d.status = any(${sql.literal(`array['${OPEN_STATUSES.join("','")}']`)})
         order by d.decided_at asc
         limit ${limit}
      `
    )

    return yield* Effect.orDie(
      Schema.decodeUnknownEffect(Schema.Array(QueueItem))(
        rows.map((row) => ({
          decisionId: row.id,
          documentId: row.document_id,
          filename: row.filename,
          outcome: row.outcome,
          status: row.status,
          railsFired: row.rails_fired,
          retrievalMode: row.retrieval_mode,
          grounded: row.grounded,
          decidedAt: row.decided_at.toISOString()
        }))
      )
    )
  })

export const GetDecision = (input: { readonly decisionId: string }) =>
  Effect.gen(function*() {
    const db = yield* Db

    const rows = yield* db.scoped((sql, orgId) =>
      sql<{
        id: string
        document_id: string
        filename: string
        outcome: string
        status: string
        rationale: string
        rails_fired: ReadonlyArray<string>
        retrieval_mode: string
        grounded: boolean
        model: string
        decided_at: Date
      }>`
        select d.id, d.document_id, s.filename, d.effective_outcome as outcome, d.status, d.rationale,
               d.rails_fired, d.retrieval_mode, d.grounded, d.model, d.decided_at
          from decisions d
          join source_documents s on s.id = d.document_id
         where d.organization_id = ${orgId} and d.id = ${input.decisionId}
      `
    )
    const row = rows[0]
    if (row === undefined) return null

    /*
     * Each citation joined to the chunk it cites, LEFT so a deleted chunk still returns the citation.
     *
     * The clause text is what the console highlights inside — the same text rail 2 checked the excerpt
     * against. A null means the chunk is gone, and showing that is the honest thing: a decision whose clause
     * no longer exists cannot be audited the way it was made.
     */
    const citations = yield* db.scoped((sql, orgId) =>
      sql<{
        chunk_id: string
        clause_ref: string | null
        excerpt: string
        clause_text: string | null
      }>`
        select c.chunk_id, c.clause_ref, c.excerpt, k.content as clause_text
          from decision_citations c
          left join document_chunks k on k.id = c.chunk_id
         where c.organization_id = ${orgId} and c.decision_id = ${input.decisionId}
         order by c.ordinal asc
      `
    )

    return yield* Effect.orDie(
      Schema.decodeUnknownEffect(DecisionDetail)({
        decisionId: row.id,
        documentId: row.document_id,
        filename: row.filename,
        outcome: row.outcome,
        status: row.status,
        rationale: row.rationale,
        railsFired: row.rails_fired,
        retrievalMode: row.retrieval_mode,
        grounded: row.grounded,
        model: row.model,
        decidedAt: row.decided_at.toISOString(),
        citations: citations.map((citation) => ({
          citation: {
            chunk_id: citation.chunk_id,
            clause_ref: citation.clause_ref,
            excerpt: citation.excerpt
          },
          clauseText: citation.clause_text
        }))
      })
    )
  })
