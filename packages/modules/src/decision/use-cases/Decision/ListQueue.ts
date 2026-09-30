/**
 * The review queue, and the detail behind one decision.
 *
 * Ordered oldest-first, which is the opposite of most feeds and is deliberate: a review queue is a backlog,
 * and the oldest item is the one closest to breaching whatever the client was promised. Newest-first would
 * bury the urgent work under the fresh work.
 */
import { Db } from "@ea/database/Database"
import { DecisionDetail, QueueItem } from "@ea/modules/decision/domain/Decision"
import { clampPageSize } from "@ea/modules/shared/domain/Page"
import { Effect, Schema } from "effect"

/** Statuses a reviewer can still act on. `approved` and `rejected` are settled and leave the queue. */
const OPEN_STATUSES = ["pending_review", "needs_attention"] as const

export const ListQueue = (input: {
  readonly limit?: number | undefined
  /**
   * The keyset from a previous page: the last row's decided-at and id, in that order.
   *
   * Decoded by the caller, because a cursor that cannot be read is a transport-level refusal (a 400) and not
   * something this use case should have an error channel for.
   */
  readonly after?: readonly [decidedAt: string, decisionId: string] | undefined
  /** Narrows to one intake, which is how a client polls for the outcome of a document it just uploaded. */
  readonly intakeId?: string | undefined
}) =>
  Effect.gen(function*() {
    const db = yield* Db
    const limit = clampPageSize(input.limit)

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
           ${
        input.intakeId === undefined
          ? sql``
          /*
           * The tenant predicate is on `orgId`, not on `d.organization_id`. They are equal here — the outer query
           * already filters the decision — but `dep:check` insists on the literal form, and it is right to: a
           * correlated predicate is only as good as the correlation, and a later edit to the outer query could
           * quietly widen this one. The intake id is caller-supplied, so without this the filter is an oracle for
           * whether an id exists in some other organization.
           */
          : sql`and exists (select 1 from intakes i where i.id = ${input.intakeId}
                        and i.organization_id = ${orgId}
                        and i.document_id = d.document_id)`
      }
           ${
        input.after === undefined
          ? sql``
          // A row-value comparison, so the keyset is one index range rather than an OR of two predicates.
          // Ascending here, because the queue is a backlog and the oldest item is the urgent one.
          : sql`and (d.decided_at, d.id) > (${input.after[0]}::timestamptz, ${input.after[1]})`
      }
         order by d.decided_at asc, d.id asc
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
