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
import { Db, withDatabase } from "@ea/database/Database"
import { CurrentOrg } from "@ea/domain/Identity"
import {
  DocumentBlobMissing,
  DocumentRowMissing,
  UnknownEventType,
  WorkflowNotStarted
} from "@ea/modules/decision/domain/Errors"
import { ExecuteDecision } from "@ea/modules/decision/use-cases/Execution"
import { Blobs, DocumentParser } from "@ea/modules/intake/domain/Document"
import type { UnsupportedDocument } from "@ea/modules/intake/domain/Errors"
import {
  ANYDOC_PARSER_VERSION,
  type MistralOcrConfig,
  mistralOcrConfig,
  ocrParserVersion
} from "@ea/modules/intake/server/Document"
import { IndexPolicyDocument } from "@ea/modules/policy/use-cases/Chunk"
import { DraftFromEmail, MarkInboundFailed } from "@ea/modules/sales/use-cases/Inbound"
import { type Cache, readThrough } from "@ea/modules/shared/domain/Cache"
import { Collection } from "@ea/modules/shared/domain/Corpus"
import { isTerminal } from "@ea/modules/shared/domain/Errors"
import type { QueueMessage } from "@ea/modules/shared/domain/Event"
import { ConsumeEvent, type EventRow } from "@ea/modules/shared/use-cases/Event"
import { Effect, Schema } from "effect"
import type { SqlClient, SqlError } from "effect/sql"

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

const IndexPayload = Schema.Struct({
  documentId: Schema.String,
  collection: Collection,
  title: Schema.String
})

const DraftFromEmailPayload = Schema.Struct({
  inboundMessageId: Schema.String
})
const ExecutePayload = Schema.Struct({
  decisionId: Schema.String,
  action: Schema.Literals(["dry_run", "post_to_ledger", "schedule_payment"])
})

/**
 * The slice of the `DECIDE` Workflow binding this file uses.
 *
 * Structural for the same reason every other binding here is: it keeps the shape to what is actually called
 * and lets `Bindings.ts` take its type from the caller rather than the reverse.
 */
export interface DecideBinding {
  readonly create: (
    options: { readonly id: string; readonly params: unknown }
  ) => Promise<{ readonly id: string }>
}

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

/*
 * Private again: the Workflow's `Parse` step goes through `cachedDocumentTextFor` below, not this.
 *
 * It stays in `apps/worker` rather than moving to a slice, and that is a boundary decision rather than
 * laziness: it needs `Blobs` and `DocumentParser` (intake's ports) and fails with `DocumentRowMissing` and
 * `DocumentBlobMissing` (decision's errors), so any slice it moved into would have to import another
 * slice's domain. The app is the one place allowed to name both.
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
    if (row === undefined) return yield* new DocumentRowMissing({ documentId })

    const bytes = yield* blobs.get(row.r2_key)
    if (bytes === null) {
      return yield* new DocumentBlobMissing({ documentId, r2Key: row.r2_key })
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
/*
 * Imported rather than restated, and assembled from EVERY tier that could have produced the text.
 *
 * The version describes the PARSER, so it belongs with the parser — this constant read "text-1" while the
 * parser was being replaced by tier 2, and nothing in the build would have noticed the key describing a
 * parser that no longer ran.
 *
 * Tier 3 made it a function rather than a constant. Which parser produced a document's text depends on the
 * document AND on whether OCR is configured for this deployment, so a key naming only tier 2 would let a
 * deployment with OCR read an entry written by one without it — text from a different parser, against which
 * the same spans verify differently. Enabling or disabling OCR is now a key change, which is the same
 * property a version bump has.
 */
const parserVersion = (ocr: MistralOcrConfig | undefined) =>
  ocr === undefined ? ANYDOC_PARSER_VERSION : `${ANYDOC_PARSER_VERSION}+${ocrParserVersion(ocr)}`

const documentTextKey = (documentId: string, ocr: MistralOcrConfig | undefined) =>
  `doc:${parserVersion(ocr)}:${documentId}`

/** One hour. Long enough to cover a redelivery storm, short enough that a stale entry costs nothing. */
const DOCUMENT_TEXT_TTL_SECONDS = 3600

/*
 * Exported so the Workflow's `Parse` step goes through the SAME cache the queue path used to.
 *
 * The step memo covers a retry within one instance; this covers two different events naming one document,
 * which the memo cannot see. Both are needed, and they key on the same parser version.
 *
 * The return type is written out because it is EXPORTED: inferred, it named `UnsupportedDocument` by a path
 * through `node_modules`, and declaration emit refused it (`TS2883`).
 */
export const cachedDocumentTextFor = (
  documentId: string,
  ocr: MistralOcrConfig | undefined
): Effect.Effect<
  string,
  DocumentBlobMissing | DocumentRowMissing | SqlError.SqlError | UnsupportedDocument,
  Blobs | Cache | CurrentOrg | Db | DocumentParser | SqlClient.SqlClient
> =>
  readThrough({
    key: documentTextKey(documentId, ocr),
    ttlSeconds: DOCUMENT_TEXT_TTL_SECONDS,
    compute: documentTextFor(documentId)
  })

/**
 * Maps one event row to the work it names. Requires `CurrentOrg`, which `ConsumeEvent` supplies.
 *
 * Takes the `DECIDE` binding as a parameter rather than reaching for `env`: the same inversion every
 * adapter uses, and it keeps this file testable without a Worker.
 */
const workFor = (startDecide: DecideBinding) => (row: EventRow) =>
  Effect.gen(function*() {
    switch (row.type) {
      case "document.decide": {
        const payload = yield* Schema.decodeUnknownEffect(DecidePayload)(row.payload)
        const orgId = yield* CurrentOrg
        /*
         * **The flip.** The pipeline is no longer run here — a Workflow instance is started and this
         * returns, and the message is acked.
         *
         * Three things move with it, and each is why this was not a one-line change:
         *
         * - **The row's finish belongs to the instance.** Returning normally would have `ConsumeEvent`
         *   mark the event `done` while the decision was still being made, which is the one thing this
         *   table must not do. Hence `WorkflowStarted`.
         * - **The retry policy moves to the Workflow.** The message is acked, so Queues will not redeliver
         *   it; the instance's per-step retries own transient failure, and `NonRetryableError` owns terminal.
         * - **The tenant travels in the params**, because an instance has no session and no event row.
         *
         * The instance id is DERIVED from the event, not generated: Cloudflare rejects a duplicate id, so a
         * redelivery that somehow reaches here cannot start a second instance for the same event. That is
         * the same "derived, never generated" rule the decide key follows, applied one layer out.
         */
        const instance = yield* Effect.tryPromise({
          try: () =>
            startDecide.create({
              id: `event-${row.id}`,
              params: {
                eventId: row.id,
                orgId,
                documentId: payload.documentId,
                vertical: payload.vertical
              }
            }),
          // Transient by default: a failure to CREATE an instance means no work was started, so a
          // redelivery is exactly right and `isTerminal` will not classify this as terminal.
          catch: (cause) => new WorkflowNotStarted({ eventId: row.id, reason: String(cause) })
        })
        return { _tag: "WorkflowStarted" as const, workflowInstanceId: instance.id }
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
      case "document.index": {
        /*
         * Inline in the consumer rather than a Workflow: one parse and one batched embedding call, retried as a
         * whole by Queues, and idempotent because `IndexPolicyDocument` REPLACES a document's chunks. The text
         * comes through the same tiered parser and cache as decide, so a scanned manual reaches OCR when it is
         * configured and is refused as `UnsupportedDocument` (terminal) when it is not.
         */
        const payload = yield* Schema.decodeUnknownEffect(IndexPayload)(row.payload)
        const ocr = yield* mistralOcrConfig
        const text = yield* cachedDocumentTextFor(payload.documentId, ocr)
        yield* IndexPolicyDocument({
          documentId: payload.documentId,
          title: payload.title,
          text,
          collection: payload.collection
        })
        return
      }
      case "quote.draft-from-email": {
        /*
         * A customer's email, read into a draft quote. Inline in the consumer, like `document.index`: one model call,
         * retried as a whole by Queues, and idempotent — `DraftFromEmail` skips a message already drafted and a unique
         * index stops a racing delivery drafting it twice. A TERMINAL failure is written onto the message so the inbox
         * shows it; a transient one is left for the retry and the message stays "received" in between.
         */
        const payload = yield* Schema.decodeUnknownEffect(DraftFromEmailPayload)(row.payload)
        yield* DraftFromEmail(payload.inboundMessageId).pipe(
          Effect.tapError((error) =>
            isTerminal(error)
              ? MarkInboundFailed(payload.inboundMessageId, `Kon niet gelezen worden (${error._tag}).`)
              : Effect.void
          )
        )
        return
      }
      default:
        return yield* new UnknownEventType({ type: row.type })
    }
  })

/*
 * **The provide block is gone, and that is the flip's dividend.**
 *
 * It used to build `DecideDocumentLayer` over `WorkflowEnginePg` and `PolicySearchLive` PER MESSAGE, with a
 * module docstring explaining why none of it could be memoised: the engine captured a connection and a
 * tenant at layer build, because `WorkflowEngine.Encoded` forces every method to have `R = never`. That was
 * not a workaround — it was the only correct place given a per-invocation connection and a per-message
 * tenant — and it existed entirely because the pipeline ran here.
 *
 * It does not run here any more. Starting a Workflow instance needs a binding and an id, so the queue path
 * needs no engine, no policy port and no pipeline layer. `decision.execute` needs only what the app layer
 * already provides.
 */

/**
 * Handles one message end to end: one connection, one tenant, one recorded outcome.
 *
 * `withDatabase` is the outermost wrapper because it decides connection lifetime, and everything inside —
 * the tenant lookup, the workflow engine, the activities — needs that one connection. One per message,
 * which is what the Workers six-simultaneous-connection limit and the batch semaphore are sized against.
 */
export const dispatchEvent = (startDecide: DecideBinding) => (message: QueueMessage) =>
  withDatabase(ConsumeEvent(message.eventId, workFor(startDecide))).pipe(
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
  )
