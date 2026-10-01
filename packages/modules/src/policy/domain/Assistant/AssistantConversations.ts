/**
 * The port for a reviewer's conversation, and the place the tenancy rule is enforced by the type.
 *
 * **Every method requires `CurrentOrg`**, which is the point of this file. The agent's isolation is by
 * Durable Object NAME and by nothing else — one name is one instance and it never moves (ADR-0018) — so a
 * conversation id that reached the namespace without an organization in it would let one tenant address
 * another's conversation. Carrying `CurrentOrg` in `R` means the adapter composes the name from a tenant it
 * was given rather than one a caller chose, and **a handler that forgot the tenant does not compile**. It is
 * the same shape every store in this repo uses, for the same reason: there is deliberately no overload that
 * takes an `orgId`, because a caller that can name a tenant is a caller that can pick the wrong one.
 *
 * A port rather than the binding directly because `packages/modules` compiles with `types: []` and cannot
 * see `DurableObjectNamespace`. The adapter takes the binding as a parameter, which by the rule in AGENTS.md
 * makes it a `server`-ring implementation living in this slice rather than glue living in `apps/worker`.
 */
import type { CurrentOrg } from "@ea/domain/Identity"
import type { Effect } from "effect"
import { Schema } from "effect"
import { Context } from "effect"
import type { ConversationUnavailable } from "../Errors/ConversationUnavailable.ts"
import type { AssistantConversation, AssistantTurn } from "./Assistant.ts"

/**
 * A conversation id, constrained so it cannot forge another tenant's name.
 *
 * The adapter builds the Durable Object name by joining the organization and this id with `SEPARATOR`. So an
 * id containing the separator could close its own segment and open another organization's — a path-traversal
 * in a namespace rather than a filesystem. **That is why this is a schema and not `Schema.String`**: the
 * pattern is the defence, and it lives here so both the RPC payload and the adapter share exactly one
 * definition of what an id may be.
 *
 * Restricted to what a URL-safe opaque id needs, which a uuid or a nanoid both satisfy.
 */
export const ConversationId = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{1,64}$/)
).annotate({
  identifier: "ConversationId",
  description: "1-64 characters of [A-Za-z0-9_-]: no separator, so it cannot address another tenant"
})

/**
 * How the organization and the conversation id are joined into a Durable Object name.
 *
 * `:` is excluded from `ConversationId`, which is what makes the join unambiguous. Exported so the adapter
 * and its tests cannot disagree about it — a mismatch would not fail, it would silently point at a different
 * conversation.
 */
export const SEPARATOR = ":"

export interface AssistantConversationsService {
  /** The conversation so far. An unknown id is an EMPTY conversation, not an error: it is a new one. */
  readonly history: (
    id: string
  ) => Effect.Effect<typeof AssistantConversation.Encoded, ConversationUnavailable, CurrentOrg>
  /** Appends a turn and returns the conversation including it. */
  readonly record: (
    id: string,
    turn: typeof AssistantTurn.Encoded
  ) => Effect.Effect<typeof AssistantConversation.Encoded, ConversationUnavailable, CurrentOrg>
}

/**
 * Every method requires `CurrentOrg`, deliberately: the Durable Object name is composed from the tenant, so a
 * handler that forgot the tenant must not compile (ADR-0025).
 *
 * @effect-expect-leaking CurrentOrg
 */
export class AssistantConversations extends Context.Service<AssistantConversations, AssistantConversationsService>()(
  "policy/AssistantConversations"
) {}

/**
 * The Durable Object name for a conversation.
 *
 * Pure, exported, and tested — because it is the tenancy boundary. If it ever stopped including the
 * organization, nothing would fail: every conversation would simply become shared, which is a bug that
 * presents as a feature until someone reads another organization's questions.
 */
export const conversationName = (orgId: string, id: string): string => `${orgId}${SEPARATOR}${id}`
