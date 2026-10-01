/** One line in a person's list of conversations — what the index row holds, and nothing an answer depends on. */
import { AskableCollection } from "@ea/modules/shared/domain/Corpus"
import { Schema } from "effect"

export class ConversationSummary extends Schema.Class<ConversationSummary>("policy/ConversationSummary")({
  id: Schema.String,
  title: Schema.String,
  collection: AskableCollection,
  turnCount: Schema.Int,
  updatedAt: Schema.String
}) {}

/** The first question, trimmed to what a list line can hold. */
export const conversationTitle = (question: string): string => {
  const flat = question.replace(/\s+/g, " ").trim()
  return flat.length <= 120 ? (flat === "" ? "Vraag" : flat) : `${flat.slice(0, 119)}…`
}
