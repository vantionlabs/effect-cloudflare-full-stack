/**
 * Batch disposition: which message gets acked, which gets retried.
 *
 * Pure — fake message objects, no queue, no database. The interesting property is precisely the one that
 * `batch.ackAll()` / `batch.retryAll()` would destroy, so it is asserted per message rather than in
 * aggregate.
 */
import type { Disposition } from "@ea/modules/shared/use-cases/Event"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { consumeBatch, type QueueMessageLike } from "../src/platform/QueueHandler.ts"

const message = (body: unknown) => {
  const calls: Array<"ack" | "retry"> = []
  const msg: QueueMessageLike = {
    body,
    ack: () => calls.push("ack"),
    retry: () => calls.push("retry")
  }
  return { msg, calls }
}

const valid = (eventId: string) => ({ eventId, type: "document.decide" })

const run = (
  messages: ReadonlyArray<QueueMessageLike>,
  handle: (id: string) => Disposition
) =>
  Effect.runPromise(
    consumeBatch({ messages }, (m) => Effect.succeed(handle(m.eventId))) as Effect.Effect<void, never, never>
  )

describe("consumeBatch", () => {
  it("acks a handled message and retries a failed one, independently", async () => {
    /*
     * The assertion `ackAll`/`retryAll` cannot make.
     *
     * Under `retryAll` the healthy message here would be redelivered because its neighbour failed — which
     * on a paid model means paying for nine re-runs to retry one failure.
     */
    const ok = message(valid("ok"))
    const bad = message(valid("bad"))

    await run(
      [ok.msg, bad.msg],
      (id) => id === "bad" ? { _tag: "Retry", reason: "provider timed out" } : { _tag: "Done" }
    )

    expect(ok.calls).toEqual(["ack"])
    expect(bad.calls).toEqual(["retry"])
  })

  it("ACKS a terminal failure rather than retrying it", async () => {
    // It is recorded in `events` and would fail identically on redelivery, so retrying is pure waste.
    const terminal = message(valid("gone"))
    await run([terminal.msg], () => ({ _tag: "Terminal", reason: "DocumentNotFound" }))
    expect(terminal.calls).toEqual(["ack"])
  })

  it("ACKS an undecodable body instead of retrying it five times into the DLQ", async () => {
    // A malformed message will not become well-formed later. Retrying only delays the inevitable, and
    // the DLQ would see it five deliveries on with nothing more to say.
    const junk = message({ notAnEvent: true })
    const good = message(valid("ok"))

    await run([junk.msg, good.msg], () => ({ _tag: "Done" }))

    expect(junk.calls).toEqual(["ack"])
    // And the valid message beside it is unaffected.
    expect(good.calls).toEqual(["ack"])
  })

  it("disposes of every message in a full batch", async () => {
    // Guards a silent partial: a message neither acked nor retried is redelivered after the visibility
    // timeout, which looks like a duplicate rather than like a bug in this loop.
    const batch = Array.from({ length: 10 }, (_, i) => message(valid(`e${i}`)))
    await run(
      batch.map((entry) => entry.msg),
      (id) => id === "e3" ? { _tag: "Retry", reason: "transient" } : { _tag: "Done" }
    )

    expect(batch.every((entry) => entry.calls.length === 1)).toBe(true)
    expect(batch[3]!.calls).toEqual(["retry"])
  })
})
