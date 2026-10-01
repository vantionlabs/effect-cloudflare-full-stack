/**
 * The Ask page's data, as atoms over the console's own RPC — never the public v1 HTTP API.
 *
 * The documents query has a `serializationKey`, which is what lets `atoms/dehydrate.ts` carry its server-side
 * result into the browser: without it the page would fetch the list again after hydration. Module scope, so the
 * atom is one value rather than a new one per render (see `thread-atoms.ts`).
 */
import { Api } from "@/rpc"

/** Refreshed after an upload, which is when the list can change. */
const KNOWLEDGE_DOCUMENTS_KEY = "knowledge-documents"

export const knowledgeDocumentsAtom = Api.query("Intake.list", { collection: "knowledge", limit: 100 }, {
  serializationKey: "knowledge-documents",
  reactivityKeys: [KNOWLEDGE_DOCUMENTS_KEY]
})

export const askAtom = Api.mutation("Ask.question")

export const uploadAtom = Api.mutation("Intake.upload")
