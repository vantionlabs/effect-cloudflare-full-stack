/**
 * The conversational surface's transport edge.
 *
 * Almost all of this is the same three decisions `AskRpcLive` makes, and the one addition is the interesting
 * part: the conversation store is provided by the composition root, because it is a Durable Object binding
 * and `dep:check` forbids this package from naming an adapter.
 *
 * The toolkit is still built PER REQUEST — `AskToolkitLive` captures the tenant at layer build, so a memoised
 * one would capture a single organization and serve it to everybody, which is the worst version of that bug
 * because it works perfectly in a single-tenant test.
 */
import { AskAnswer, AskAnswerCitation } from "@ea/modules/policy/domain/Ask"
import { AssistantConversation, AssistantRpcs } from "@ea/modules/policy/domain/Assistant"
import { askToolkitFor } from "@ea/modules/policy/use-cases/Ask"
import {
  ArchiveConversation,
  AskAndIndex,
  ConversationHistory,
  ListConversations,
  RenameConversation
} from "@ea/modules/policy/use-cases/Assistant"
import { PolicySearchLive } from "@ea/modules/policy/use-cases/Retrieval"
import type { AskableCollection } from "@ea/modules/shared/domain/Corpus"
import { Effect, Layer, Schema } from "effect"
import { serveForTenant } from "../Serve.ts"

/**
 * The success schemas are `Schema.Class`es, and encoding one requires an INSTANCE — returning the use case's plain
 * objects failed on the server ("Expected AskAnswer"), which reached the console as an untyped defect. `AskRpcLive`
 * records the same trap; neither procedure here had been called by a client until the conversation page.
 */
const asConversation = Schema.decodeUnknownSync(AssistantConversation)

/** The same cap `AskRpcLive` applies, for the same reason: an unbounded question is an unbounded bill. */
const MAX_QUESTION_LENGTH = 2000

export const AssistantRpcLive = AssistantRpcs.toLayer(
  Effect.succeed({
    "Assistant.ask": (payload: {
      readonly conversationId: string
      readonly question: string
      readonly collection?: AskableCollection | undefined
    }) =>
      serveForTenant(
        AskAndIndex(
          payload.conversationId,
          payload.question.slice(0, MAX_QUESTION_LENGTH),
          payload.collection ?? "knowledge"
        ).pipe(
          // Built per request for the collection asked, exactly as `AskRpcLive` does — see that file for why.
          Effect.provide(askToolkitFor(payload.collection ?? "knowledge").pipe(Layer.provideMerge(PolicySearchLive)))
        )
      ).pipe(
        /*
         * `catchTag("AiError")`, NOT `orDie` — the third time this distinction has mattered, and the reason
         * is unchanged: `orDie` discards the WHOLE error channel, so `UngroundedAnswer` and
         * `ConversationUnavailable` would both become 500s. The refusal that exists to stop an unverifiable
         * citation reaching a reviewer would be reported as a server fault.
         */
        Effect.catchTag("AiError", Effect.die),
        Effect.map(({ answer, conversation }) => ({
          answer: new AskAnswer({
            answer: answer.answer,
            citations: answer.citations.map((citation) => new AskAnswerCitation(citation)),
            steps: answer.steps,
            truncated: answer.truncated
          }),
          conversation: asConversation(conversation)
        }))
      ),
    /*
     * No model, no toolkit, no retrieval — reading a conversation must not be able to cost anything, or
     * opening the console would.
     */
    "Assistant.history": (payload: { readonly conversationId: string }) =>
      serveForTenant(Effect.map(ConversationHistory(payload.conversationId), asConversation)),
    "Assistant.conversations": () => serveForTenant(ListConversations),
    "Assistant.rename": (payload: { readonly conversationId: string; readonly title: string }) =>
      serveForTenant(RenameConversation(payload.conversationId, payload.title)),
    "Assistant.archive": (payload: { readonly conversationId: string }) =>
      serveForTenant(ArchiveConversation(payload.conversationId))
  })
)
