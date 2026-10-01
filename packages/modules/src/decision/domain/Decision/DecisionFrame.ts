/**
 * What the decision slice says over the socket.
 *
 * `QueueChanged` lived with the transport's frames until ADR-0021; it belongs here, beside the queue it is about. A
 * transport that could name a `QueueChanged` was a transport that knew about decisions.
 */
import { UserId } from "@ea/domain/Identity"
import { Schema } from "effect"

/**
 * The queue changed. **A nudge, not the change itself.**
 *
 * The payload is a reason, not a row, and the client re-reads through RPC. That keeps one source of truth:
 * a frame carrying decision fields would be a second copy of the queue arriving by a second route, and the
 * two would disagree the first time a broadcast raced a write. `reason` exists so the console can be
 * specific in the UI — "approved by someone else" reads better than "something changed".
 */
export class QueueChanged extends Schema.TaggedClass<QueueChanged>()("QueueChanged", {
  reason: Schema.Literals(["decided", "approved", "rejected", "ingested"]),
  /** Who caused it, so a client can ignore its own echo rather than refetching for nothing. */
  byUserId: Schema.NullOr(UserId)
}) {}

/** The decision slice's frames, for the api package to fold into the client's union. */
export const DecisionFrame = Schema.Union([QueueChanged])
export type DecisionFrame = typeof DecisionFrame.Type
