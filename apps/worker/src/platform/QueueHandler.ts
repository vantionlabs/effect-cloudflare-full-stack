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
 * Messages are processed **sequentially**, not concurrently. Each one opens a scoped database connection,
 * and Workers allows six simultaneous outgoing connections per invocation — a batch of ten in parallel
 * would exhaust that and fail in a way that looks like a database problem.
 *
 * One thing this file does NOT do: decide which organization the work belongs to. A queue consumer has no
 * session, so it cannot provide `CurrentUser`, and it deliberately gets a different tag — `CurrentOrg`,
 * resolved from the event row by the caller. `grep CurrentOrg` then enumerates every place the system acts
 * without a user, which is the list a tenancy audit needs. A message that named its own organization would
 * be a hole in the seam.
 */
import { QueueMessage } from "@ea/modules/shared/domain/Event"
import type { Disposition } from "@ea/modules/shared/use-cases/Event"
import { Effect, Schema } from "effect"

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
export const consumeBatch = (
  batch: QueueBatchLike,
  handle: (message: QueueMessage) => Effect.Effect<Disposition>
) =>
  Effect.forEach(
    batch.messages,
    (raw) =>
      Effect.gen(function*() {
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
            ...(disposition._tag === "Done" ? {} : { reason: disposition.reason })
          })
        )

        return yield* Effect.sync(() =>
          // Terminal is acked: it is recorded, and it would fail identically next time.
          disposition._tag === "Retry" ? raw.retry() : raw.ack()
        )
      }),
    // Sequential. See the module docstring: six outgoing connections per invocation is the ceiling.
    { concurrency: 1, discard: true }
  )
