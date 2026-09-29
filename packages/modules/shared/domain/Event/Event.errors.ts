/**
 * Whether a failure should be retried, and why that decision belongs here rather than at a call site.
 *
 * docket burned three model calls on every deterministic bug, because its consumer retried everything.
 * The distinction is not about severity — it is about whether the *same input* could produce a different
 * result next time:
 *
 *   **Terminal.** A document that does not exist will not exist on retry. An unknown vertical will still
 *   be unknown. Rails that refused will refuse identically, because they are a pure function of the same
 *   inputs. These are acked, recorded, and stopped: retrying is pure waste, and on a paid model it is
 *   waste with an invoice.
 *
 *   **Retryable.** A provider timing out, a connection dropping, a rate limit. Same input, different
 *   outcome later. These are left for Queues to redeliver with its own backoff.
 *
 * Getting this backwards in either direction is costly: retry a terminal failure and you pay five times
 * for the same refusal; ack a transient one and a document silently never gets decided.
 */
import { Schema } from "effect"

/** The document named by an event no longer exists. Terminal. */
export class DocumentNotFound extends Schema.TaggedError<DocumentNotFound>()("DocumentNotFound", {
  documentId: Schema.String
}) {}

/** No extraction schema is registered for this vertical. Terminal — a deploy fixes it, a retry does not. */
export class UnknownVertical extends Schema.TaggedError<UnknownVertical>()("UnknownVertical", {
  vertical: Schema.String
}) {}

/**
 * The rails refused to let this proceed automatically. Terminal, and **not an error condition**.
 *
 * It means the product worked: a human is now looking at it. Retrying would re-run the model to reach the
 * same refusal, which is the specific waste this classification exists to prevent.
 */
export class RailsRefused extends Schema.TaggedError<RailsRefused>()("RailsRefused", {
  decisionId: Schema.String,
  outcome: Schema.String
}) {}

/** The event row named by a message is gone. Terminal: there is nothing to read current state from. */
export class EventNotFound extends Schema.TaggedError<EventNotFound>()("EventNotFound", {
  eventId: Schema.String
}) {}

export type TerminalError = DocumentNotFound | UnknownVertical | RailsRefused | EventNotFound

/**
 * The tags that must never be retried.
 *
 * A closed list rather than a predicate on the error's shape, so adding a terminal failure is a visible
 * one-line diff that a reviewer can question — and so the default for anything unrecognised is to RETRY,
 * which is the safe direction: paying twice beats silently dropping a document.
 */
const TERMINAL_TAGS: ReadonlySet<string> = new Set([
  "DocumentNotFound",
  "UnknownVertical",
  "RailsRefused",
  "EventNotFound",
  // A document we cannot parse will not become parseable on redelivery.
  "UnsupportedDocument",
  // An amount we cannot read exactly will read the same way next time.
  "AmbiguousAmount"
])

export const isTerminal = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "_tag" in error &&
  TERMINAL_TAGS.has(String((error as { readonly _tag: unknown })._tag))
