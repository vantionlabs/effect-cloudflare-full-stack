/**
 * `AskCorpus`, remembered.
 *
 * The composition is the whole use case: answer the question with the existing agent, then record what
 * happened in the conversation. Nothing about the answering changes — same loop, same step bound, same
 * refusal — which is the property that makes this safe to add. If this file could influence how an answer is
 * produced, it would be a second place the grounding rule lives.
 *
 * The one thing it adds to the loop is CONTEXT: the last few turns, so a follow-up ("and for the 500 model?") can be
 * understood. Context is not evidence — `AskCorpus` still only accepts citations of chunks served in this run.
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
 *
 * The conversation's INDEX row is updated by `AskAndIndex` (Conversations.ts), not here: this use case stays free of
 * the database, so its tests need none — and the index is a list line, never part of an answer.
 */
import { AssistantConversations } from "@ea/modules/policy/domain/Assistant"
import { AskCorpus, MAX_PRIOR_TURNS } from "@ea/modules/policy/use-cases/Ask"
import type { AskableCollection } from "@ea/modules/shared/domain/Corpus"
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
  question: string,
  collection: AskableCollection = "knowledge"
) =>
  Effect.gen(function*() {
    const conversations = yield* AssistantConversations
    const now = yield* Clock.currentTimeMillis
    const askedAt = new Date(now).toISOString()

    const earlier = yield* conversations.history(conversationId)
    const history = earlier.turns.slice(-MAX_PRIOR_TURNS).map((turn) => ({
      question: turn.question,
      answer: turn.answer,
      refusedBecause: turn.refusedBecause
    }))

    const answer = yield* Effect.catchTag(
      AskCorpus(question, collection, history),
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
            sources: [],
            askedAt
          }),
          () => Effect.fail(refusal)
        )
    )

    const conversation = yield* conversations.record(conversationId, {
      question,
      answer: answer.answer,
      citations: answer.citations.map((citation) => citation.chunk_id),
      // Copied from the VERIFIED, located citations — the same objects the answer is returned with.
      sources: answer.citations.map((citation) => ({
        chunk_id: citation.chunk_id,
        clause_ref: citation.clause_ref,
        excerpt: citation.excerpt,
        heading: citation.heading ?? null,
        document: citation.document ?? null
      })),
      askedAt
    })

    return { answer, conversation }
  })

/** The history, with no model call — so opening a conversation costs nothing. */
export const ConversationHistory = (conversationId: string) =>
  Effect.flatMap(AssistantConversations, (conversations) => conversations.history(conversationId))
