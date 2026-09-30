/**
 * The conversation store could not be reached.
 *
 * A separate error from `UngroundedAnswer` because the two mean opposite things to a caller: a refusal is the
 * product working and must be shown to the reviewer verbatim, while this is infrastructure and the remedy is
 * to retry. Collapsing them would let a Durable Object outage be reported as "the corpus does not support
 * this", which is the most misleading sentence this system could produce.
 *
 * **The answer survives it.** `AskInConversation` records the turn AFTER the answer is produced and verified,
 * so a failure here loses the conversation's memory of an answer, never the answer. That ordering is the
 * whole reason this error is recoverable rather than fatal.
 */
import { Schema } from "effect"

export class ConversationUnavailable extends Schema.TaggedError<ConversationUnavailable>()("ConversationUnavailable", {
  conversationId: Schema.String,
  reason: Schema.String
}) {}
