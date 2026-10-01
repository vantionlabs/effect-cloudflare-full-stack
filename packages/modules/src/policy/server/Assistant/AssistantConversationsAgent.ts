/**
 * The conversation port over the Agents SDK binding.
 *
 * In `policy/server` and not in `apps/worker`, by the rule in AGENTS.md: an adapter that takes its binding as
 * a PARAMETER is not glue. The binding's type is described structurally — `packages/modules` compiles with
 * `types: []`, so `DurableObjectNamespace` is not visible here and must not be — which is the same inversion
 * `R2Blobs` and the Workers AI adapters use.
 *
 * **What this file is really for is composing the name.** Everything else is a fetch and a decode. The name
 * is `${orgId}:${conversationId}`, taken from `CurrentOrg` rather than from an argument, so the tenant cannot
 * be chosen by a caller — and `ConversationId` forbids the separator, so an id cannot close its own segment
 * and address another organization's conversation. Two halves of one defence, and neither is sufficient
 * alone: the schema stops a forged id, the context stops a forged tenant.
 */
import { CurrentOrg } from "@ea/domain/Identity"
import {
  AssistantConversation,
  AssistantConversations,
  type AssistantTurn,
  conversationName
} from "@ea/modules/policy/domain/Assistant"
import { ConversationUnavailable } from "@ea/modules/policy/domain/Errors"
import { Effect, Layer, Schema } from "effect"

/**
 * The slice of the Durable Object namespace this adapter uses.
 *
 * Structural rather than `DurableObjectNamespace<AssistantAgent>`: this is the whole surface needed, and
 * describing it here is what lets the adapter live in a module. `apps/worker/src/platform/Bindings.ts`
 * declares the matching shape.
 */
export interface AssistantsBinding {
  readonly idFromName: (name: string) => unknown
  readonly get: (id: unknown) => { readonly fetch: (request: Request) => Promise<Response> }
}

const decode = Schema.decodeUnknownResult(AssistantConversation)

export const AssistantConversationsAgent = (
  binding: AssistantsBinding
): Layer.Layer<AssistantConversations> =>
  Layer.succeed(AssistantConversations)({
    history: (id) => Effect.flatMap(CurrentOrg, (orgId) => call(binding, orgId, id, undefined)),
    record: (id, turn) => Effect.flatMap(CurrentOrg, (orgId) => call(binding, orgId, id, turn))
  })

/**
 * One request to the agent, decoded.
 *
 * A `GET` reads and a `POST` appends — appending one turn rather than writing the whole conversation, so a
 * caller cannot rewrite history even through this adapter.
 *
 * Every failure becomes `ConversationUnavailable` with a reason, including a decode failure. A decode failure
 * genuinely is unavailability from a caller's point of view: the agent answered something that is not a
 * conversation, and there is nothing the reviewer can do about it except retry. The reason string carries
 * enough to tell the two apart in a log.
 */
const call = (
  binding: AssistantsBinding,
  orgId: string,
  id: string,
  turn: typeof AssistantTurn.Encoded | undefined
): Effect.Effect<typeof AssistantConversation.Encoded, ConversationUnavailable> =>
  Effect.gen(function*() {
    const name = conversationName(orgId, id)
    const stub = binding.get(binding.idFromName(name))

    const response = yield* Effect.tryPromise({
      try: () =>
        stub.fetch(
          new Request(
            // The URL is required by `Request` and ignored by the agent, which routes on method alone. A
            // hostname that cannot resolve is deliberate: nothing here should ever reach the network.
            "https://assistant.invalid/",
            turn === undefined
              ? { method: "GET" }
              : {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(turn)
              }
          )
        ),
      catch: (cause) =>
        new ConversationUnavailable({ conversationId: id, reason: `the agent could not be reached: ${String(cause)}` })
    })

    if (!response.ok) {
      const body = yield* Effect.orElseSucceed(
        Effect.tryPromise(() => response.text()),
        () => ""
      )
      return yield* new ConversationUnavailable({
        conversationId: id,
        reason: `the agent answered ${response.status}: ${body}`
      })
    }

    const body = yield* Effect.tryPromise({
      try: () => response.json() as Promise<unknown>,
      catch: () => new ConversationUnavailable({ conversationId: id, reason: "the agent answered a non-JSON body" })
    })

    const conversation = decode(body)
    if (conversation._tag === "Failure") {
      return yield* new ConversationUnavailable({
        conversationId: id,
        reason: `the agent answered something that is not a conversation: ${conversation.failure.message}`
      })
    }
    return conversation.success
  })
