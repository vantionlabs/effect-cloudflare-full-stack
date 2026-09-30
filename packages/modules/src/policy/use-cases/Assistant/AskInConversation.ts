/**
 * `AskCorpus`, remembered.
 *
 * The composition is the whole use case: answer the question with the existing agent, then record what
 * happened in the conversation. Nothing about the answering changes — same loop, same step bound, same
 * refusal — which is the property that makes this safe to add. If this file could influence how an answer is
 * produced, it would be a second place the grounding rule lives.
 *
 * ## The ordering is the design
 *
 * **Answer first, record second.** So:
 *
 * - a conversation-store failure loses the memory of an answer, never the answer — which is why
 *   `ConversationUnavailable` is recoverable rather than fatal;
 * - and a refusal is recorded too, deliberately. `UngroundedAnswer` is the product working, and a
 *   conversation that dropped its refusals would read as though the corpus had answered everything. So the
 *   refusal is caught, written as a turn, and then **re-raised** — the caller still gets the error, because
 *   the reviewer must see the refusal and not an empty answer.
 *
 * That last point is the subtle one: recording a refusal must not swallow it. The test asserts both halves.
 */
import { AssistantConversations } from "@ea/modules/policy/domain/Assistant"
import { AskCorpus } from "@ea/modules/policy/use-cases/Ask"
import { Clock, Effect } from "effect"

/**
 * Answers a question inside a conversation, and returns the answer with the conversation it now belongs to.
 *
 * `CurrentOrg` is required transitively — by `AskCorpus` for the corpus and by `AssistantConversations` for
 * the Durable Object name — so there is no way to call this without a tenant, and no parameter through which
 * a caller could supply one.
 */
export const AskInConversation = (
  conversationId: string,
  question: string
) =>
  Effect.gen(function*() {
    const conversations = yield* AssistantConversations
    const now = yield* Clock.currentTimeMillis
    const askedAt = new Date(now).toISOString()

    const answer = yield* Effect.catchTag(
      AskCorpus(question),
      "UngroundedAnswer",
      (refusal) =>
        /*
         * Record, then re-raise. Written the other way round first — returning the refusal as a turn — and
         * it was wrong for the reason `Serve.ts` and `AskRpcLive.ts` both record: a refusal that stops being
         * an error stops being visible, and the caller would render an answer-shaped thing with no answer.
         */
        Effect.flatMap(
          conversations.record(conversationId, {
            question,
            refusedBecause: refusal.reasons.join("; "),
            citations: [],
            askedAt
          }),
          () => Effect.fail(refusal)
        )
    )

    const conversation = yield* conversations.record(conversationId, {
      question,
      answer: answer.answer,
      citations: answer.citations.map((citation) => citation.chunk_id),
      askedAt
    })

    return { answer, conversation }
  })

/** The history, with no model call — so opening a conversation costs nothing. */
export const ConversationHistory = (conversationId: string) =>
  Effect.flatMap(AssistantConversations, (conversations) => conversations.history(conversationId))
