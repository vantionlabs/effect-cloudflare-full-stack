/**
 * The Ask page's data, as atoms over the console's own RPC — never the public v1 HTTP API.
 *
 * Every query has a `serializationKey`, which is what lets `rpc/dehydrate.ts` carry its server-side result into the
 * browser: without it the page would fetch again after hydration. Module scope (and `Atom.family` for the per-id
 * history), so each atom is one value rather than a new one per render (see `components/thread/thread-atoms.ts`).
 */
import { Api } from "@/rpc/client"
import { Atom } from "effect/reactivity"

/** Refreshed after an upload, which is when the list can change. */
const KNOWLEDGE_DOCUMENTS_KEY = "knowledge-documents"
/** Refreshed after every ask, rename or archive — any of which reorders or changes the list. */
export const CONVERSATIONS_KEY = "ask-conversations"
/** One per conversation, refreshed after a question is asked in it — answered OR refused, both are recorded. */
export const historyKey = (conversationId: string) => `ask-history:${conversationId}`

export const knowledgeDocumentsAtom = Api.query("Intake.list", { collection: "knowledge", limit: 100 }, {
  serializationKey: "knowledge-documents",
  reactivityKeys: [KNOWLEDGE_DOCUMENTS_KEY]
})

export const conversationsAtom = Api.query("Assistant.conversations", {}, {
  serializationKey: "ask-conversations",
  reactivityKeys: [CONVERSATIONS_KEY]
})

export const historyAtom = Atom.family((conversationId: string) =>
  Api.query("Assistant.history", { conversationId }, {
    serializationKey: `ask-history:${conversationId}`,
    reactivityKeys: [historyKey(conversationId)]
  })
)

/** Ask inside a conversation (the Agents SDK keeps it). Answer and record in one round trip. */
export const askInConversationAtom = Api.mutation("Assistant.ask")
export const archiveConversationAtom = Api.mutation("Assistant.archive")

export const uploadAtom = Api.mutation("Intake.upload")
