/**
 * The reviewer's assistant, as the Agents SDK requires it: a class extending `Agent`, exported from the
 * Worker's entry and declared in `exports`.
 *
 * **Glue only**, the same rule `RoomDurableObject` follows. What a conversation *is* lives in
 * `@ea/modules/policy/domain/Assistant` as schemas and one pure function, unit-tested with no `workerd`.
 * What is left here is what genuinely belongs to the deployment: the class, its state contract, and the
 * request surface.
 *
 * ## Why `Agent` and not `AIChatAgent`
 *
 * `AIChatAgent` is the batteries-included one, and it **requires the Vercel AI SDK** — `ai@^6||^7` plus
 * `@ai-sdk/react` are peer dependencies of that entry point. Adopting it would mean a second model
 * abstraction beside `effect/ai`, which is the one thing ADR-0023 decided against, for a chat loop this
 * repo already has in `AskCorpus` with a grounding refusal the AI SDK knows nothing about.
 *
 * The plain `Agent` class needs none of those peers — verified by installing `agents@0.24.0` and reading
 * its manifest: `ai`, `react`, `zod` and the MCP SDKs are all **peer**, so the core is reachable without
 * them. So this file gets durable per-conversation state and the scheduling primitives, and the model
 * stays `effect/ai`'s.
 *
 * ## Why this agent never answers a question
 *
 * It records answers; it does not produce them. Two reasons, and the first is not about cost:
 *
 * - **A Durable Object cannot validate the identity it is handed** (ADR-0019). The corpus is tenant-scoped
 *   and `Db.scoped` requires `CurrentOrg`, which the Worker resolves from a session. An agent that queried
 *   the corpus itself would be querying on behalf of an identity it cannot check, in the one place the
 *   tenancy seam is not a compile error.
 * - **`dep:check` forbids it**, and now says so for agents and not only rooms: an outbound `connect()`
 *   keeps the object resident and billable for up to fifteen minutes.
 *
 * So the shape is the same two hops a room uses for a write: client → Worker → Postgres, then Worker →
 * agent. The Worker runs `AskCorpus`, and hands over what it decided.
 *
 * ## Why there is no `schedule()` call here yet
 *
 * Because our own ADR-0024 gives that job to something else: *"waiting on a human or an external event →
 * Workflows' `waitForEvent`."* An approval chased in 48 hours is durable execution, not interaction, and
 * putting it here would be the third execution model that ADR-0023's rule 2 says needs an argument first.
 * What is genuinely this class's — interactive state, and a stream a reviewer can reconnect to — is what it
 * does.
 *
 * ## No decorators
 *
 * `@callable()` is the SDK's RPC surface and it wants a Babel plugin (`@babel/plugin-proposal-decorators`
 * is one of the SDK's own dependencies, applied through a Rolldown or Vite plugin). This Worker is bundled
 * by wrangler, so that pipeline is not in play, and `onRequest` costs nothing by comparison. Decorators
 * themselves are NOT blocked by this repo's `erasableSyntaxOnly` — that was checked rather than assumed,
 * and a decorated method compiles under it — so this is a bundler decision, reversible if RPC is wanted.
 */
import {
  appendTurn,
  AssistantConversation,
  AssistantTurn,
  emptyConversation
} from "@ea/modules/policy/domain/Assistant"
import { Agent } from "agents"
import { Schema } from "effect"

/** The agent's state is the conversation's ENCODED form: Durable Object state must be JSON. */
type State = typeof AssistantConversation.Encoded

const decodeTurn = Schema.decodeUnknownResult(AssistantTurn)
const decodeConversation = Schema.decodeUnknownResult(AssistantConversation)

export class AssistantAgent extends Agent<never, State> {
  override initialState: State = emptyConversation

  /**
   * Refuses a state that is not a conversation.
   *
   * The SDK calls this for a write from the server AND from a connected client, which is the reason it
   * exists: a client can propose state. Without a check, a browser could write anything into a reviewer's
   * conversation, including a turn claiming a citation that was never verified — the one thing this
   * product must not let happen. Decoded rather than duck-typed, using the same schema the domain defines,
   * so the agent and the console cannot disagree about what a turn is.
   */
  override validateStateChange(next: State): void {
    const result = decodeConversation(next)
    if (result._tag === "Failure") {
      throw new Error(`rejected a state that is not an AssistantConversation: ${result.failure.message}`)
    }
  }

  /**
   * The request surface: read the conversation, or append a turn the Worker has already decided.
   *
   * `POST` takes one turn rather than a whole conversation on purpose — handing over the entire state
   * would let a caller rewrite history, where appending can only add to it.
   */
  override async onRequest(request: Request): Promise<Response> {
    if (request.method === "GET") {
      return Response.json(this.state)
    }
    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405 })
    }

    const body: unknown = await request.json()
    const turn = decodeTurn(body)
    if (turn._tag === "Failure") {
      // 400 with the reason: the only caller is our own Worker, so a decode failure here is a bug in it
      // and a silent 500 would say nothing about which field was wrong.
      return Response.json({ error: turn.failure.message }, { status: 400 })
    }

    this.setState(appendTurn(this.state, body as typeof AssistantTurn.Encoded))
    return Response.json(this.state)
  }
}
