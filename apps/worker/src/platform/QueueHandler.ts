/**
 * The Worker's `queue` handler: batch semantics, and nothing else.
 *
 * **Every message is acked or retried individually.** `batch.ackAll()` and `batch.retryAll()` are never
 * used, and that is the single most important line in this file: one poison message under `retryAll`
 * re-runs the nine healthy ones beside it, which on a paid model means paying nine times to redeliver one
 * failure. Cloudflare offers the bulk methods because they are convenient, not because they are correct.
 *
 * Deciding *what happened* is `ConsumeEvent`'s job and is tested without a queue. This file only turns a
 * `Disposition` into an `ack()` or a `retry()`, which is the part that needs real Cloudflare message
 * objects and therefore a real Worker.
 *
 * Concurrency is bounded by a `Semaphore` at the platform's actual limit rather than serialised by guess.
 * **Workers allows six simultaneous outgoing connections per invocation**, and each message opens a scoped
 * database connection — so a batch of ten in parallel exhausts that and fails in a way that looks like a
 * database problem. Six permits express the real constraint: a batch of ten proceeds with genuine
 * parallelism up to the ceiling, which `concurrency: 1` threw away for no reason.
 *
 * The semaphore is created **per batch**, not per isolate, because the limit is per *invocation*. A
 * module-scope one would be shared by concurrent invocations in the same isolate and would throttle them
 * against each other.
 *
 * One thing this file does NOT do: decide which organization the work belongs to. A queue consumer has no
 * session, so it cannot provide `CurrentUser`, and it deliberately gets a different tag — `CurrentOrg`,
 * resolved from the event row by the caller. `grep CurrentOrg` then enumerates every place the system acts
 * without a user, which is the list a tenancy audit needs. A message that named its own organization would
 * be a hole in the seam.
 */
import { QueueMessage } from "@ea/modules/shared/domain/Event"
import type { Disposition } from "@ea/modules/shared/use-cases/Event"
import { Effect, Schema, Semaphore } from "effect"

/** The slice of a Cloudflare queue message this handler uses. */
export interface QueueMessageLike {
  readonly body: unknown
  readonly ack: () => void
  readonly retry: () => void
}

export interface QueueBatchLike {
  readonly messages: ReadonlyArray<QueueMessageLike>
}

/**
 * Runs each message and disposes of it.
 *
 * `handle` receives the decoded body and returns a `Disposition`. Note what happens to a body that does
 * not decode: it is **acked**, not retried. A malformed message will not become well-formed on
 * redelivery, and retrying it five times before the DLQ accomplishes nothing but delay.
 */
/**
 * Simultaneous outgoing connections a Worker invocation may hold open.
 *
 * A platform limit, not a tuning knob. Raising it does not make the platform allow more; it makes the
 * seventh connection fail.
 */
const OUTBOUND_CONNECTION_LIMIT = 6

export const consumeBatch = <R>(
  batch: QueueBatchLike,
  /*
   * Generic in `R`, so the requirements of the work flow out to the caller's runtime.
   *
   * It was `Effect<Disposition>` — `R = never` — which forced the call site into a cast, and the cast hid a
   * missing `CurrentUser` until the pipeline was run for the first time and every message dead-lettered with
   * `Service not found`. The type was right and the cast overrode it.
   */
  handle: (message: QueueMessage) => Effect.Effect<Disposition, never, R>
) =>
  Effect.flatMap(Semaphore.make(OUTBOUND_CONNECTION_LIMIT), (connections) =>
    Effect.forEach(
      batch.messages,
      (raw) =>
        connections.withPermit(Effect.gen(function*() {
          const decoded = yield* Effect.result(Schema.decodeUnknownEffect(QueueMessage)(raw.body))

          if (decoded._tag === "Failure") {
            // Unparseable: ack. It cannot succeed later, and the DLQ would only see it five deliveries on.
            yield* Effect.logWarning("queue.message.undecodable").pipe(
              Effect.annotateLogs({ body: JSON.stringify(raw.body) })
            )
            return yield* Effect.sync(() => raw.ack())
          }

          const message = decoded.success
          const disposition = yield* handle(message)

          // Correlated by event id on every line, which is the only way to reassemble one document's
          // journey from three separate invocations.
          yield* Effect.logInfo("queue.message.handled").pipe(
            Effect.annotateLogs({
              eventId: message.eventId,
              type: message.type,
              disposition: disposition._tag,
              /*
               * Three shapes now, so the annotation is a switch rather than a negation.
               *
               * `HandedOff` carries an instance id instead of a reason, and logging it is the link between
               * a queue message and the Workflow that took over — without which the only record of that
               * hand-off would be a database column nobody thought to read.
               */
              ...(disposition._tag === "Terminal" || disposition._tag === "Retry"
                ? { reason: disposition.reason }
                : disposition._tag === "HandedOff"
                ? { workflowInstanceId: disposition.workflowInstanceId }
                : {})
            })
          )

          return yield* Effect.sync(() =>
            /*
             * Only a transient failure is retried.
             *
             * Terminal is acked: it is recorded, and it would fail identically next time. **HandedOff is
             * acked too**, and that is the flip's central change — the message's job was to start the work,
             * and it did. Retrying it would start a SECOND instance for the same event; the Workflow's own
             * retry policy owns what happens after.
             */
            disposition._tag === "Retry" ? raw.retry() : raw.ack()
          )
        })),
      // Unbounded here because the SEMAPHORE is the bound. Expressing the limit once, where the reason
      // lives, beats a number repeated at every call site.
      { concurrency: "unbounded", discard: true }
    ))
