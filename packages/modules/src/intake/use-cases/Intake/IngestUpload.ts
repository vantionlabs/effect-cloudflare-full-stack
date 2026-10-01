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
import { Db } from "@ea/database/Database"
import { CurrentUser } from "@ea/domain/Identity"
import { Ids } from "@ea/domain/Ids"
import { Blobs, DocumentId, DocumentParser } from "@ea/modules/intake/domain/Document"
import { IntakeId } from "@ea/modules/intake/domain/Intake"
import type { Collection } from "@ea/modules/shared/domain/Corpus"
import { decideEventKey } from "@ea/modules/shared/domain/Event"
import { EmitEvent } from "@ea/modules/shared/use-cases/Event"
import { writeUsage } from "@ea/modules/shared/use-cases/Usage"
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

/**
 * The vertical an uploaded transactional document is decided as.
 *
 * Hardcoded because there is exactly one, and named rather than inlined so the day a second arrives the
 * question "where is the vertical chosen?" has one answer. Choosing it will be a real decision — from the
 * content type, a client's configuration, or a classifier — and it should not be discovered as a string
 * literal buried in an insert.
 */
const INVOICE_VERTICAL = "invoice"

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
        // The meter commits with the rows it counts: a rolled-back upload is never billed. Keyed on the intake,
        // so nothing that replays this transaction can count it twice.
        yield* writeUsage(sql, orgId, [{
          meter: "documents.ingested",
          quantity: 1,
          subjectId: documentId,
          idempotencyKey: `intake:${intakeId}`
        }])
      })
    )

    /*
     * (4) Emit `document.decide` — the link that makes the pipeline fire.
     *
     * Without this the decide workflow was wired and never triggered: a document was stored, rows were
     * written, and nothing ever asked for a decision. Deliberately AFTER the transaction rather than inside
     * it, which is the outbox shape the plan describes — `EmitEvent` writes its own `events` row and then
     * sends, so a failed send leaves a recoverable `queued` row for the sweeper rather than losing the work.
     *
     * **Only transactional documents.** A policy document is corpus, not a case: deciding one would extract
     * invoice fields from a procurement policy and route the nonsense to a human. The `collection` column
     * is what separates the two everywhere else, and it is what separates them here.
     */
    if (input.collection === "transactional") {
      yield* EmitEvent({
        type: "document.decide",
        idempotencyKey: decideEventKey(documentId, INVOICE_VERTICAL),
        payload: { documentId, vertical: INVOICE_VERTICAL }
      })
    }

    return { documentId, intakeId, textLength: parsed.text.length } satisfies UploadResult
  })
