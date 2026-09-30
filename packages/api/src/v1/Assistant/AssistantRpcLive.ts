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
import { AssistantRpcs } from "@ea/modules/policy/domain/Assistant"
import { AskToolkitLive } from "@ea/modules/policy/use-cases/Ask"
import { AskInConversation, ConversationHistory } from "@ea/modules/policy/use-cases/Assistant"
import { PolicySearchLive } from "@ea/modules/policy/use-cases/Retrieval"
import { Effect, Layer } from "effect"
import { serveForTenant } from "../Serve.ts"

/** The same cap `AskRpcLive` applies, for the same reason: an unbounded question is an unbounded bill. */
const MAX_QUESTION_LENGTH = 2000

export const AssistantRpcLive = AssistantRpcs.toLayer(
  Effect.succeed({
    "Assistant.ask": (payload: { readonly conversationId: string; readonly question: string }) =>
      serveForTenant(
        AskInConversation(payload.conversationId, payload.question.slice(0, MAX_QUESTION_LENGTH)).pipe(
          Effect.provide(AskToolkitLive.pipe(Layer.provideMerge(PolicySearchLive)))
        )
      ).pipe(
        /*
         * `catchTag("AiError")`, NOT `orDie` — the third time this distinction has mattered, and the reason
         * is unchanged: `orDie` discards the WHOLE error channel, so `UngroundedAnswer` and
         * `ConversationUnavailable` would both become 500s. The refusal that exists to stop an unverifiable
         * citation reaching a reviewer would be reported as a server fault.
         */
        Effect.catchTag("AiError", Effect.die)
      ),
    /*
     * No model, no toolkit, no retrieval — reading a conversation must not be able to cost anything, or
     * opening the console would.
     */
    "Assistant.history": (payload: { readonly conversationId: string }) =>
      serveForTenant(ConversationHistory(payload.conversationId))
  })
)
