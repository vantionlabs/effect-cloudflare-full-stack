/**
 * What each queue event actually does — the one thing the Worker was missing.
 *
 * `QueueHandler` decides ack-versus-retry, `ConsumeEvent` records state and resolves the tenant, and this
 * file maps an event type to the work. Until it existed the `queue` handler passed a constant `Done`, so
 * **every message was acked unprocessed and the deployed Worker could not decide a document** — the
 * pipeline was built, tested and unreachable (docs/services.md §3.1).
 *
 * ## Why this is a separate file from Main.ts
 *
 * `Main.ts` is the composition root and holds no logic. This holds the one `switch` that says what an
 * event means, which is logic — thin, but real. Keeping it here means the composition root stays a list of
 * port-to-adapter bindings, and this file can be read on its own to answer "what happens when a document
 * is uploaded".
 *
 * ## Where the layers are provided, and why it has to be here
 *
 * `WorkflowEnginePg` captures its connection **and its tenant** at layer build, because
 * `WorkflowEngine.Encoded` forces every method to have `R = never`. Two consequences, and both decide the
 * shape of this file:
 *
 * 1. It cannot live in the memoised app layer. A socket cannot outlive the invocation that opened it on
 *    Workers, so an engine built per isolate would capture a dead connection.
 * 2. It cannot be built before the tenant is known. `ConsumeEvent` discovers the organization by reading
 *    the event row, so the engine is built *inside* the work callback, where `CurrentOrg` exists.
 *
 * So the engine and the policy port are provided here, per message, and that is not a workaround — it is
 * the only correct place given a per-invocation connection and a per-message tenant.
 */
import { DocumentBlobMissing, DocumentRowMissing, UnknownEventType } from "@ea/modules/decision/domain/Errors"
import { WorkflowEnginePg } from "@ea/modules/decision/server/Workflow"
import { DecideDocumentLayer, DecideDocumentWorkflow } from "@ea/modules/decision/use-cases/Decision"
import { ExecuteDecision } from "@ea/modules/decision/use-cases/Execution"
import { Blobs, DocumentParser } from "@ea/modules/intake/domain/Document"
import { PolicySearchLive } from "@ea/modules/policy/use-cases/Retrieval"
import { readThrough } from "@ea/modules/shared/domain/Cache"
import type { QueueMessage } from "@ea/modules/shared/domain/Event"
import { Db, withDatabase } from "@ea/modules/shared/tables/Database"
import { ConsumeEvent, type Disposition, type EventRow } from "@ea/modules/shared/use-cases/Event"
import { Effect, Schema } from "effect"

/**
 * The payload shapes, decoded rather than trusted.
 *
 * The row's `payload` is `jsonb` written by a previous version of this code, so it is **not** a value this
 * deployment produced — a redelivery can arrive after a deploy that changed the shape. Decoding it makes
 * that a typed, terminal failure with a readable reason instead of an `undefined` propagating into a model
 * prompt.
 */
const DecidePayload = Schema.Struct({
  documentId: Schema.String,
  vertical: Schema.String
})

const ExecutePayload = Schema.Struct({
  decisionId: Schema.String,
  action: Schema.Literals(["dry_run", "post_to_ledger", "schedule_payment"])
})

/** An event type this build does not know. Terminal: a retry cannot teach it. */

/**
 * The document text, re-read from storage and re-parsed.
 *
 * **Why not carry it on the event.** The queue message is `{ eventId, type }` and the row's payload is an
 * id — deliberately, so a redelivery reads current state. Putting a whole document on a queue message
 * would also mean a second source of truth for the bytes a `source_span` is checked against.
 *
 * **Why re-parse rather than read stored markdown.** The parser version *defines* the verbatim contract:
 * its output is what spans are checked against, so a parser bump changes spans, which changes grounding.
 * Re-parsing from the original bytes means the decision is made against what the *current* parser sees,
 * and a parser upgrade is therefore visible as a changed decision rather than as a silent mismatch between
 * stored markdown and a current check. It also costs nothing for the text tier and is the same call the
 * intake path already made.
 *
 * A missing blob is a **terminal** failure: the document is gone, and no retry brings it back.
 */

const documentTextFor = (documentId: string) =>
  Effect.gen(function*() {
    const db = yield* Db
    const blobs = yield* Blobs
    const parser = yield* DocumentParser

    const rows = yield* db.scopedForOrg((sql, orgId) =>
      sql<{ r2_key: string; content_type: string; filename: string }>`
        select r2_key, content_type, filename from source_documents
         where id = ${documentId} and organization_id = ${orgId}
      `
    )
    const row = rows[0]
    if (row === undefined) return yield* Effect.fail(new DocumentRowMissing({ documentId }))

    const bytes = yield* blobs.get(row.r2_key)
    if (bytes === null) {
      return yield* Effect.fail(new DocumentBlobMissing({ documentId, r2Key: row.r2_key }))
    }

    const parsed = yield* parser.parse({
      bytes,
      contentType: row.content_type,
      filename: row.filename
    })
    return parsed.text
  })

/**
 * The cache key, and the reason this value is cacheable at all.
 *
 * **The parser version is part of the key.** A parser version *defines* the verbatim contract — its output
 * is what every `source_span` is checked against, so a parser bump changes spans, which changes grounding
 * (plan risk R6). Putting the version in the key means a bump cannot serve text the current parser would
 * not produce: it is a different key, and the old entry simply expires unread.
 *
 * That is what makes this safe where almost nothing else in this codebase is. `Cache.ts` demands that the
 * key make staleness *impossible*, and here it does — `(documentId, parserVersion)` identifies an immutable
 * value, because the bytes in R2 are written once and the parser is pinned.
 *
 * What it buys: every workflow redelivery re-derives this text, and each derivation is an R2 GET plus a
 * parse. The decide path is the hottest thing in the product and this is the only part of it that repeats
 * identical work.
 */
const PARSER_VERSION = "text-1"
const documentTextKey = (documentId: string) => `doc:${PARSER_VERSION}:${documentId}`

/** One hour. Long enough to cover a redelivery storm, short enough that a stale entry costs nothing. */
const DOCUMENT_TEXT_TTL_SECONDS = 3600

const cachedDocumentTextFor = (documentId: string) =>
  readThrough({
    key: documentTextKey(documentId),
    ttlSeconds: DOCUMENT_TEXT_TTL_SECONDS,
    compute: documentTextFor(documentId)
  })

/** Maps one event row to the work it names. Requires `CurrentOrg`, which `ConsumeEvent` supplies. */
const workFor = (row: EventRow) =>
  Effect.gen(function*() {
    switch (row.type) {
      case "document.decide": {
        const payload = yield* Schema.decodeUnknownEffect(DecidePayload)(row.payload)
        const documentText = yield* cachedDocumentTextFor(payload.documentId)
        yield* DecideDocumentWorkflow.execute({
          documentId: payload.documentId,
          documentText,
          vertical: payload.vertical
        })
        return
      }
      case "decision.execute": {
        const payload = yield* Schema.decodeUnknownEffect(ExecutePayload)(row.payload)
        /*
         * `approvedBy` is deliberately NOT passed here.
         *
         * The queue has no user, and the approver was already recorded on the decision when a human
         * approved it. Synthesising one would put a fabricated identity in an audit column — and for an
         * auto-approved decision there genuinely is no person, which is itself the audit record.
         */
        yield* ExecuteDecision({ decisionId: payload.decisionId, action: payload.action })
        return
      }
      default:
        return yield* Effect.fail(new UnknownEventType({ type: row.type }))
    }
  }).pipe(
    // Built per message: see the module docstring for why neither of these can be memoised per isolate.
    Effect.provide(DecideDocumentLayer),
    Effect.provide(WorkflowEnginePg),
    Effect.provide(PolicySearchLive)
  )

/**
 * Handles one message end to end: one connection, one tenant, one recorded outcome.
 *
 * `withDatabase` is the outermost wrapper because it decides connection lifetime, and everything inside —
 * the tenant lookup, the workflow engine, the activities — needs that one connection. One per message,
 * which is what the Workers six-simultaneous-connection limit and the batch semaphore are sized against.
 */
export const dispatchEvent = (message: QueueMessage): Effect.Effect<Disposition, never, never> =>
  withDatabase(ConsumeEvent(message.eventId, workFor)).pipe(
    /*
     * A failure to even record the outcome is a RETRY, not a crash.
     *
     * `ConsumeEvent` already classifies the work's own failures. What is caught here is narrower and
     * different: the database being unreachable, so that neither the work nor the bookkeeping happened. The
     * safe direction is to let Queues redeliver — paying twice beats silently dropping a document, and the
     * idempotency keys make the second attempt cheap.
     */
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.logError("queue.dispatch.failed").pipe(
          Effect.annotateLogs({ eventId: message.eventId, cause: String(cause) })
        ),
        { _tag: "Retry" as const, reason: "the event could not be read or recorded" }
      )
    )
  ) as Effect.Effect<Disposition, never, never>
