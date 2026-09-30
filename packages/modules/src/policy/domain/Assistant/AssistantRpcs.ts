/**
 * The conversational surface.
 *
 * RPC only, for exactly the reason `AskRpcs` gives and one more. The reason it inherits: an agent's prompt,
 * tool set and step bound are the least stable things in the system, and the v1 HTTP API is a frozen contract
 * a third party compiles against. The reason it adds: **a conversation is not a durable record**, so it must
 * not appear in an API whose shape implies one. The answers are in Postgres and reachable through the v1
 * decision endpoints; the conversation is interaction state (ADR-0025).
 *
 * Note what the payloads do NOT carry: an organization. The tenant comes from the session, and the Durable
 * Object name is composed from it — see `AssistantConversations.ts`.
 */
import { AuthenticatedRpc } from "@ea/domain/Identity"
import { AskAnswer } from "@ea/modules/policy/domain/Ask"
import { ConversationUnavailable, UngroundedAnswer } from "@ea/modules/policy/domain/Errors"
import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { AssistantConversation } from "./Assistant.ts"
import { ConversationId } from "./AssistantConversations.ts"

export const AssistantRpcs = RpcGroup.make(
  /**
   * Ask inside a conversation.
   *
   * Returns the answer AND the conversation it now belongs to, in one round trip, so the console never has to
   * ask "what does the history look like now?" and cannot render a turn the server did not record.
   */
  Rpc.make("Assistant.ask", {
    payload: {
      /**
       * Chosen by the client, and constrained by the schema rather than trusted.
       *
       * A client picking its own id is what makes a conversation resumable without a create call. The
       * pattern is what stops that being a way to address another tenant: the separator is excluded, so an
       * id cannot close its own segment in the Durable Object name.
       */
      conversationId: ConversationId,
      /** Capped in the handler, not trusted from here — a long question is a long paid prompt. */
      question: Schema.String
    },
    success: Schema.Struct({
      answer: AskAnswer,
      conversation: AssistantConversation
    }),
    /*
     * Two errors, and they mean opposite things.
     *
     * `UngroundedAnswer` is the product working and must be shown to the reviewer verbatim.
     * `ConversationUnavailable` is infrastructure, and the remedy is to retry. A union rather than one error
     * because a console that could not tell them apart would report a Durable Object outage as "the corpus
     * does not support this" — the most misleading sentence this system could produce.
     */
    error: Schema.Union([UngroundedAnswer, ConversationUnavailable])
  }),
  /** The history, with no model call — so opening a conversation is free. */
  Rpc.make("Assistant.history", {
    payload: { conversationId: ConversationId },
    success: AssistantConversation,
    error: ConversationUnavailable
  })
).middleware(AuthenticatedRpc)
