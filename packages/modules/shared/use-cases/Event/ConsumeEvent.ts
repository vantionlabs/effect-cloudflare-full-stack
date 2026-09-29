/**
 * Handling one event: read current state, do the work, record the outcome.
 *
 * Deliberately handles **one** event and knows nothing about batches. Batch semantics — which message to
 * ack, which to retry — belong at the Worker's `queue` handler, because that is where the Cloudflare
 * message objects live. Keeping them apart is what lets the interesting behaviour be tested without a
 * queue at all.
 *
 * The message carried only an id, so the first thing this does is read the row. That is the point: by the
 * time a redelivery arrives, the document may have been decided, superseded or deleted, and the *current*
 * answer is the right one — not whatever was true when the message was written.
 */
import { type EventId, EventNotFound, isTerminal } from "@ea/modules/shared/domain/Event"
import { Db } from "@ea/modules/shared/tables/Database"
import { Effect } from "effect"

export interface EventRow {
  readonly id: string
  readonly type: string
  readonly idempotency_key: string
  readonly status: string
  readonly payload: Record<string, unknown>
}

/** What the consumer concluded, which the `queue` handler turns into an ack or a retry. */
export type Disposition =
  | { readonly _tag: "Done" }
  /** Terminal: acked and recorded. Retrying would fail identically, so it is not retried. */
  | { readonly _tag: "Terminal"; readonly reason: string }
  /** Transient: left for Queues to redeliver under its own backoff. */
  | { readonly _tag: "Retry"; readonly reason: string }

/**
 * What gets written to `events.error`, and read by whoever is asked why a document was not decided.
 *
 * The TAG comes first, deliberately. A `Schema.TaggedError` is an `Error`, so the obvious
 * `failure.message` compiles and returns an empty string for most of them — recording a `failed` row whose
 * reason is blank, which is worse than useless because it looks like the field works. The tag is the part
 * that names the failure class, and the classification in `isTerminal` keys on it too.
 */
const describe = (failure: unknown): string => {
  if (typeof failure === "object" && failure !== null && "_tag" in failure) {
    const tag = String((failure as { readonly _tag: unknown })._tag)
    const message = failure instanceof Error && failure.message !== "" ? `: ${failure.message}` : ""
    return `${tag}${message}`
  }
  return failure instanceof Error && failure.message !== "" ? failure.message : String(failure)
}

/**
 * Runs `work` for an event and records what happened.
 *
 * `work` receives the freshly read row. Its failures are classified by `isTerminal`, and the default for
 * an unrecognised failure is to RETRY — the safe direction, because paying twice beats silently dropping
 * a document.
 */
export const ConsumeEvent = (
  eventId: EventId,
  work: (row: EventRow) => Effect.Effect<void, unknown>
) =>
  Effect.gen(function*() {
    const db = yield* Db

    const rows = yield* db.scoped((sql) =>
      sql<EventRow>`
        select id, type, idempotency_key, status, payload from events where id = ${eventId}
      `
    )
    const row = rows[0]
    if (row === undefined) {
      // Nothing to read state from and nothing to record against. Acked: a redelivery cannot help.
      return { _tag: "Terminal", reason: new EventNotFound({ eventId }).message } satisfies Disposition
    }

    /*
     * Already finished. Ack without doing the work.
     *
     * This is the cheap half of idempotency and it fires on every redelivery of completed work — earlier
     * than the workflow memo, and earlier than the decide_key constraint.
     */
    if (row.status === "done" || row.status === "dead") {
      return { _tag: "Done" } satisfies Disposition
    }

    yield* db.scoped((sql) =>
      sql`
        update events
           set status = 'processing', started_at = coalesce(started_at, now()), deliveries = deliveries + 1
         where id = ${eventId}
      `
    )

    const result = yield* Effect.result(work(row))

    if (result._tag === "Success") {
      yield* db.scoped((sql) => sql`update events set status = 'done', finished_at = now() where id = ${eventId}`)
      return { _tag: "Done" } satisfies Disposition
    }

    const failure = result.failure
    const reason = describe(failure)

    if (isTerminal(failure)) {
      // Recorded in the product, not just in a dashboard: `failed` rows are queryable beside the
      // documents they concern, which is the whole reason this table exists.
      yield* db.scoped((sql) =>
        sql`
          update events set status = 'failed', error = ${reason}, finished_at = now() where id = ${eventId}
        `
      )
      return { _tag: "Terminal", reason } satisfies Disposition
    }

    // Left as `processing`. Queues owns the retry, and the row records how many deliveries it has taken.
    return { _tag: "Retry", reason } satisfies Disposition
  })
