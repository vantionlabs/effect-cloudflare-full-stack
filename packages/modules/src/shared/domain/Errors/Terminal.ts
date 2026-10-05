/**
 * Whether a failure should be retried, and why that decision belongs here rather than at a call site.
 *
 * docket burned three model calls on every deterministic bug, because its consumer retried everything. The
 * distinction is not about severity — it is about whether the *same input* could produce a different result
 * next time:
 *
 *   **Terminal.** A document that does not exist will not exist on retry. An unknown vertical will still be
 *   unknown. Rails that refused will refuse identically. These are acked, recorded, and stopped: retrying is
 *   pure waste, and on a paid model it is waste with an invoice.
 *
 *   **Retryable.** A provider timing out, a connection dropping, a rate limit. Same input, different outcome
 *   later. These are left for Queues to redeliver with its own backoff.
 *
 * Getting this backwards in either direction is costly: retry a terminal failure and you pay five times for
 * the same refusal; ack a transient one and a document silently never gets decided.
 */

import type { DocumentNotFound } from "./DocumentNotFound.ts"
import type { EventNotFound } from "./EventNotFound.ts"
import type { RailsRefused } from "./RailsRefused.ts"
import type { UnknownVertical } from "./UnknownVertical.ts"

export type TerminalError = DocumentNotFound | UnknownVertical | RailsRefused | EventNotFound

/**
 * The tags that must never be retried.
 *
 * A closed list of STRINGS rather than a predicate on the error's shape, for two reasons. Adding a terminal
 * failure is then a visible one-line diff a reviewer can question, and the default for anything
 * unrecognised is to RETRY — the safe direction, because paying twice beats silently dropping a document.
 *
 * Two of these tags belong to errors defined in OTHER slices, and they are named as strings on purpose: a
 * string costs `shared` no dependency on `intake` or on `Money`, where importing the classes would invert
 * the dependency direction the whole layout rests on.
 */
const TERMINAL_TAGS: ReadonlySet<string> = new Set([
  "DocumentNotFound",
  "UnknownVertical",
  "RailsRefused",
  "EventNotFound",
  // intake: a document we cannot parse will not become parseable on redelivery.
  "UnsupportedDocument",
  // Money: an amount we cannot read exactly will read the same way next time.
  "AmbiguousAmount",
  // decision: the blob is gone, and no retry brings it back.
  "DocumentBlobMissing",
  "DocumentRowMissing",
  // decision: this build does not know the event type. A deploy fixes it; a retry does not.
  "UnknownEventType",
  // policy: the embedder's width does not match the column. A configuration fact, so every retry fails the
  // same way — and each would spend an embedding call to find out.
  "EmbeddingWidthMismatch",
  // sales: the inbound message the event names is gone; a retry cannot bring it back.
  "InboundMessageNotFound"
])

export const isTerminal = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "_tag" in error &&
  TERMINAL_TAGS.has(String((error as { readonly _tag: unknown })._tag))
