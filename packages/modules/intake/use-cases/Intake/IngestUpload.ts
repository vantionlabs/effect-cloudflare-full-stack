/**
 * The upload use case: bytes in, a registered document and intake out.
 *
 * Ordering is the interesting part, and it is chosen so every failure leaves something
 * recoverable rather than something inconsistent:
 *
 *   1. **Parse first.** A document we cannot read is rejected before anything is stored, so an
 *      unsupported file never leaves an orphaned object in R2 or a `failed` row to clean up.
 *   2. **Write the object, then the rows.** No transaction spans R2 and Postgres, so one of them
 *      must be first. An object with no row is a harmless orphan a sweep can find by prefix; a
 *      row pointing at an object that was never written is a document that looks ingested and
 *      cannot be read. The harmless direction goes first.
 *   3. **Both rows in one transaction.** `source_documents` and `intakes` are written together —
 *      a document with no intake has no audit trail, and an intake pointing at nothing is worse.
 *
 * The parsed text is deliberately NOT stored yet: it belongs with the extraction, against which
 * the verbatim check runs. Storing it twice invites the two copies to disagree.
 */
import { Blobs, type Collection, DocumentId, DocumentParser } from "@ea/modules/intake/domain/Document"
import { IntakeId } from "@ea/modules/intake/domain/Intake"
import { CurrentUser } from "@ea/modules/shared/domain/Identity"
import { Ids } from "@ea/modules/shared/domain/Ids"
import { Db } from "@ea/modules/shared/tables/Database"
import { Effect } from "effect"

export interface UploadInput {
  readonly filename: string
  readonly contentType: string
  readonly collection: Collection
  readonly bytes: Uint8Array
}

interface UploadResult {
  readonly documentId: DocumentId
  readonly intakeId: IntakeId
  /** Characters of extracted text. Lets a caller sanity-check the parse without a second request. */
  readonly textLength: number
}

export const IngestUpload = (input: UploadInput) =>
  Effect.gen(function*() {
    const parser = yield* DocumentParser
    const blobs = yield* Blobs
    const db = yield* Db
    const ids = yield* Ids
    const identity = yield* CurrentUser

    // (1) Refuse before storing anything.
    const parsed = yield* parser.parse({
      bytes: input.bytes,
      contentType: input.contentType,
      filename: input.filename
    })

    const documentId = DocumentId.make(yield* ids.next)
    const intakeId = IntakeId.make(yield* ids.next)

    // (2) Object before rows: an orphaned object is recoverable, a dangling row is not.
    const key = yield* blobs.put({
      orgId: identity.orgId,
      documentId,
      filename: input.filename,
      contentType: input.contentType,
      bytes: input.bytes
    })

    // (3) Both rows together. `organization_id` is supplied by the seam, never by the caller.
    yield* db.scoped((sql, orgId) =>
      Effect.gen(function*() {
        yield* sql`
          insert into source_documents
            (id, organization_id, collection, filename, r2_key, content_type, size_bytes, status)
          values
            (${documentId}, ${orgId}, ${input.collection}, ${input.filename}, ${key},
             ${input.contentType}, ${input.bytes.byteLength}, 'uploaded')
        `
        yield* sql`
          insert into intakes (id, organization_id, source, document_id, created_by)
          values (${intakeId}, ${orgId}, 'upload', ${documentId}, ${identity.userId})
        `
      })
    )

    return { documentId, intakeId, textLength: parsed.text.length } satisfies UploadResult
  })
