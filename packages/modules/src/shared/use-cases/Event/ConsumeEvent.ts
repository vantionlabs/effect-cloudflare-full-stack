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
 *
 * ## This is where the queue's tenant is established
 *
 * A queue message is `{ eventId, type }` and nothing else, deliberately — a message that named its own
 * organization would be a hole in the scoping seam, because the organization would then come from a
 * parameter instead of from stored state. So the tenant has to be *discovered*, and that is the one read
 * here that cannot filter by tenant: it is asking which tenant. It is marked as such in the SQL and
 * `dep:check` counts it.
 *
 * Everything after that point runs with `CurrentOrg` provided and uses `scopedForOrg`. This function and
 * the cron are the only places in the system that provide `CurrentOrg` directly rather than deriving it
 * from a session — which is the list a tenancy audit wants.
 */
import { Db } from "@ea/database/Database"
import { CurrentOrg, OrgId } from "@ea/domain/Identity"
import { EventNotFound, isTerminal } from "@ea/modules/shared/domain/Errors"
import { type EventId } from "@ea/modules/shared/domain/Event"
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
   * Handed to a Cloudflare Workflow. The message is acked; the row stays `processing`.
   *
   * The distinction that makes the flip safe. Without it, `work` returning successfully means "the work is
   * done" and the row is marked `done` — which after the flip would be a lie, because all that succeeded
   * was *starting* an instance. A row reading `done` while a decision is still being made would break the
   * one thing this table exists for: `events` is here because "Queues has no queryable history", so a row
   * that misreports state is worse than no row.
   *
   * The instance id is recorded on the row, so `processing` is answerable rather than merely true.
   */
  | { readonly _tag: "HandedOff"; readonly workflowInstanceId: string }

/**
 * What gets written to `events.error`, and read by whoever is asked why a document was not decided.
 *
 * The TAG comes first, deliberately. A `Schema.TaggedError` is an `Error`, so the obvious
 * `failure.message` compiles and returns an empty string for most of them — recording a `failed` row whose
 * reason is blank, which is worse than useless because it looks like the field works. The tag is the part
 * that names the failure class, and the classification in `isTerminal` keys on it too.
 */
export const describeFailure = (failure: unknown): string => {
  if (typeof failure === "object" && failure !== null && "_tag" in failure) {
    const tag = String((failure as { readonly _tag: unknown })._tag)
    const message = failure instanceof Error && failure.message !== "" ? `: ${failure.message}` : ""
    return `${tag}${message}`
  }
  return failure instanceof Error && failure.message !== "" ? failure.message : String(failure)
}

/**
 * Marks an event finished, and marks one failed.
 *
 * Extracted because the queue is no longer the only thing that finishes an event: after the flip, a
 * Cloudflare Workflow instance owns the finish for `document.decide`, and it must write exactly what the
 * queue used to write. Two definitions of "done" would drift, and the one that drifted would be the one
 * nothing reads until an operator asks why a decision looks unfinished.
 */
export const markEventDone = (eventId: EventId) =>
  Effect.flatMap(Db, (db) =>
    db.scopedForOrg((sql, orgId) =>
      sql`
        update events set status = 'done', finished_at = now()
         where id = ${eventId} and organization_id = ${orgId}
      `
    ))

/** As `markEventDone`, for a failure. The reason is recorded IN THE PRODUCT, not only in a dashboard. */
export const markEventFailed = (eventId: EventId, reason: string) =>
  Effect.flatMap(Db, (db) =>
    db.scopedForOrg((sql, orgId) =>
      sql`
        update events set status = 'failed', error = ${reason}, finished_at = now()
         where id = ${eventId} and organization_id = ${orgId}
      `
    ))

/**
 * Runs `work` for an event and records what happened.
 *
 * `work` receives the freshly read row. Its failures are classified by `isTerminal`, and the default for
 * an unrecognised failure is to RETRY — the safe direction, because paying twice beats silently dropping
 * a document.
 */
/**
 * What `work` reports back.
 *
 * `void` means it finished, which keeps every existing handler unchanged. A `WorkflowStarted` means it
 * handed the work to a Cloudflare Workflow instance, and the row must NOT be marked done.
 */
export type WorkOutcome = void | { readonly _tag: "WorkflowStarted"; readonly workflowInstanceId: string }

export const ConsumeEvent = <R>(
  eventId: EventId,
  /**
   * The work. Generic in `R`, and `CurrentOrg` is **excluded from the result** because this function
   * supplies it — so a caller may require the tenant without having to know it, which is the whole point
   * of resolving it from the row.
   */
  work: (row: EventRow) => Effect.Effect<WorkOutcome, unknown, R>
) =>
  Effect.gen(function*() {
    const db = yield* Db

    /*
     * The tenant lookup, and the only unscoped statement on this path.
     *
     * A point lookup by primary key that returns the organization: it cannot filter on the thing it is
     * asking for. Kept to exactly this — id and organization_id, nothing else — so that the row's contents
     * are read again below *with* the tenant in the predicate, and a bug in this statement cannot leak a
     * payload.
     */
    const owners = yield* db.unscopedForAuth((sql) =>
      sql<{ organization_id: string }>`
        -- tenant: the organization is the answer
        select organization_id from events where id = ${eventId}
      `
    )
    const owner = owners[0]
    if (owner === undefined) {
      // Nothing to read state from and nothing to record against. Acked: a redelivery cannot help.
      return { _tag: "Terminal", reason: new EventNotFound({ eventId }).message } satisfies Disposition
    }

    return yield* handle(eventId, work).pipe(
      Effect.provideService(CurrentOrg, OrgId.make(owner.organization_id))
    )
  })

/** The rest of the work, with the tenant established. Split out so `CurrentOrg` is provided exactly once. */
const handle = <R>(
  eventId: EventId,
  work: (row: EventRow) => Effect.Effect<WorkOutcome, unknown, R>
) =>
  Effect.gen(function*() {
    const db = yield* Db

    const rows = yield* db.scopedForOrg((sql, orgId) =>
      sql<EventRow>`
        select id, type, idempotency_key, status, payload from events
         where id = ${eventId} and organization_id = ${orgId}
      `
    )
    const row = rows[0]
    if (row === undefined) {
      // Raced with a delete between the two reads. Same answer: acked, because a retry cannot help.
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

    yield* db.scopedForOrg((sql, orgId) =>
      sql`
        update events
           set status = 'processing', started_at = coalesce(started_at, now()), deliveries = deliveries + 1
         where id = ${eventId} and organization_id = ${orgId}
      `
    )

    const result = yield* Effect.result(work(row))

    if (result._tag === "Success") {
      const outcome = result.success
      /*
       * Handed off: record WHICH instance and leave the row `processing`.
       *
       * The instance marks the row finished when it is actually finished. If it dies without doing so —
       * evicted, terminated, or failed in a way its own catch did not see — the row stays `processing` with
       * an instance id on it, which is exactly what a stuck-work report needs and is the reason the id is
       * stored rather than merely logged.
       */
      if (outcome !== undefined && outcome._tag === "WorkflowStarted") {
        yield* db.scopedForOrg((sql, orgId) =>
          sql`
            update events set workflow_instance_id = ${outcome.workflowInstanceId}
             where id = ${eventId} and organization_id = ${orgId}
          `
        )
        return {
          _tag: "HandedOff",
          workflowInstanceId: outcome.workflowInstanceId
        } satisfies Disposition
      }

      yield* markEventDone(eventId)
      return { _tag: "Done" } satisfies Disposition
    }

    const failure = result.failure
    const reason = describeFailure(failure)

    if (isTerminal(failure)) {
      // Recorded in the product, not just in a dashboard: `failed` rows are queryable beside the
      // documents they concern, which is the whole reason this table exists.
      yield* markEventFailed(eventId, reason)
      return { _tag: "Terminal", reason } satisfies Disposition
    }

    // Left as `processing`. Queues owns the retry, and the row records how many deliveries it has taken.
    return { _tag: "Retry", reason } satisfies Disposition
  })
