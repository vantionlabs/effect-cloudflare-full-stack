/**
 * Editing or deleting somebody else's message.
 *
 * **Author-only, with no moderator override, and that is a decision rather than an oversight.** A moderator who
 * can rewrite what a colleague said in a thread attached to a decision can rewrite the record of why that
 * decision was made — which is the one thing this product claims you can rely on a year later. Deletion by an
 * administrator is a real requirement that will arrive, and when it does it belongs in a different operation
 * with its own audit row, not as a relaxation of this check.
 *
 * It is a distinct error from `MessageNotFound` on purpose, and that is a deliberate information trade: it tells
 * the caller the message exists. That is acceptable here because they can already see it — they are reading the
 * thread it is in — so the alternative would hide nothing and make a wrong button look like a missing message.
 */
import { Schema } from "effect"

export class NotMessageAuthor extends Schema.TaggedError<NotMessageAuthor>()("NotMessageAuthor", {
  messageId: Schema.String
}) {}
