/**
 * A reviewer's conversation with the corpus — the part that is not platform.
 *
 * `AskCorpus` answers one question and forgets it. This is what remembers, and it is deliberately a
 * **schema rather than a table**: the conversation lives in the agent's own Durable Object storage, because
 * what it buys over a Postgres table is not persistence — Postgres is better at that, and auditability is
 * this product's entire thesis — but **interactivity**: a stream a reviewer can reconnect to, and state that
 * is already where the socket is.
 *
 * So the rule, written here because this file is what both sides import:
 *
 *   an ANSWER is a durable, auditable fact          → Postgres, via the use case, as today
 *   a CONVERSATION is interaction state             → the agent
 *
 * A turn recorded here is a convenience copy of something the Worker already decided. Nothing in this file
 * is evidence: if the agent's storage were deleted, no citation and no decision would be lost, which is the
 * property that makes it safe to keep state in a place with no `select`.
 */
import { Schema } from "effect"

/**
 * One exchange, including the refusals.
 *
 * **A refusal is a turn, not an error.** `AskCorpus` refuses an answer whose citation it cannot verify, and
 * that refusal is the product working — so it is recorded with the same weight as an answer. A conversation
 * that dropped its refusals would read as though the corpus had answered everything.
 */
export class AssistantTurn extends Schema.Class<AssistantTurn>("policy/AssistantTurn")({
  question: Schema.String,
  /** Absent when the turn was refused: there is no answer to show, and an empty string would imply one. */
  answer: Schema.optional(Schema.String),
  /**
   * Why the answer was withheld, when it was. Free text from the domain's own refusal, not a code — the
   * reviewer is the audience, and "no clause in the corpus supports this" is the useful form.
   */
  refusedBecause: Schema.optional(Schema.String),
  /** Chunk ids, so the console can render the same citations the answer was verified against. */
  citations: Schema.Array(Schema.String),
  askedAt: Schema.String
}) {}

/**
 * How many turns an agent keeps.
 *
 * A bound rather than unbounded growth, because Durable Object state is read and written whole: an
 * unbounded conversation makes every message more expensive than the last, and the failure is gradual
 * rather than a crash. Older turns are dropped from the agent, not from the audit trail — the answers they
 * refer to are rows in Postgres either way, which is exactly why dropping them here is safe.
 */
export const MAX_TURNS = 50

export class AssistantConversation extends Schema.Class<AssistantConversation>("policy/AssistantConversation")({
  turns: Schema.Array(AssistantTurn)
}) {}

/** The empty conversation, as the agent's `initialState`. */
export const emptyConversation: typeof AssistantConversation.Encoded = { turns: [] }

/**
 * Appends a turn, dropping the oldest past `MAX_TURNS`.
 *
 * A pure function on the encoded form, so it is unit-testable with no agent, no Durable Object and no
 * `workerd` — the same split `@ea/realtime/Server` makes for rooms, and the reason the class in
 * `apps/worker` has almost nothing in it.
 */
export const appendTurn = (
  conversation: typeof AssistantConversation.Encoded,
  turn: typeof AssistantTurn.Encoded
): typeof AssistantConversation.Encoded => ({
  turns: [...conversation.turns, turn].slice(-MAX_TURNS)
})
