/**
 * The arrivals list: what came in, how, and what state it is in.
 *
 * Reaches SQL only through `Db.scoped`, so the organization is supplied by the seam and cannot be
 * named by the caller. There is deliberately no `organizationId` parameter — if a caller could pass
 * one, the seam would be decoration.
 */
import { Db } from "@ea/database/Database"
import { IntakeListItem } from "@ea/modules/intake/domain/Intake"
import type { Collection } from "@ea/modules/shared/domain/Corpus"
import { clampPageSize } from "@ea/modules/shared/domain/Page"
import { Effect, Schema } from "effect"

export interface ListIntakesInput {
  readonly limit?: number | undefined
  readonly collection?: Collection | undefined
  /** The keyset from a previous page: the last row's received-at and intake id, in that order. */
  readonly after?: readonly [receivedAt: string, intakeId: string] | undefined
}

export const ListIntakes = (input: ListIntakesInput) =>
  Effect.gen(function*() {
    const db = yield* Db
    const limit = clampPageSize(input.limit)

    const rows = yield* db.scoped((sql, orgId) =>
      sql<{
        intake_id: string
        document_id: string
        filename: string
        collection: string
        source: string
        status: string
        /*
         * A string, not a number. `size_bytes` is `bigint`, and the Postgres driver returns bigint as
         * text because a 64-bit integer does not fit a JS number without possible precision loss.
         * Caught by the decode below rather than by a cast, which is the argument for decoding.
         */
        size_bytes: string | number | null
        received_at: Date
      }>`
        select
          i.id             as intake_id,
          d.id             as document_id,
          d.filename       as filename,
          d.collection     as collection,
          i.source         as source,
          d.status         as status,
          d.size_bytes     as size_bytes,
          i.received_at    as received_at
        from intakes i
        join source_documents d on d.id = i.document_id
        -- The explicit tenant predicate is defence in depth, NOT redundancy. RLS is the other half,
        -- and this query is the reason the plan insists on both: written without it, it returned
        -- another organization's rows the moment the connecting role happened to bypass RLS.
        where i.organization_id = ${orgId}
        ${input.collection === undefined ? sql`` : sql`and d.collection = ${input.collection}`}
        ${
        input.after === undefined
          ? sql``
          // Descending, matching the sort: arrivals are read newest-first.
          : sql`and (i.received_at, i.id) < (${input.after[0]}::timestamptz, ${input.after[1]})`
      }
        order by i.received_at desc, i.id desc
        limit ${limit}
      `
    )

    // Decoded rather than cast: the row shape is a runtime claim about the database, and a column
    // rename that slipped through a migration should fail here rather than reach a client.
    return yield* Effect.orDie(
      Schema.decodeUnknownEffect(Schema.Array(IntakeListItem))(
        rows.map((row) => ({
          intakeId: row.intake_id,
          documentId: row.document_id,
          filename: row.filename,
          collection: row.collection,
          source: row.source,
          status: row.status,
          // Narrowed here rather than in the schema: a document size that genuinely exceeded
          // Number.MAX_SAFE_INTEGER would be a 9-petabyte upload, so the conversion is safe — but it
          // has to be deliberate rather than implicit.
          sizeBytes: Number(row.size_bytes ?? 0),
          receivedAt: row.received_at.toISOString()
        }))
      )
    )
  })
