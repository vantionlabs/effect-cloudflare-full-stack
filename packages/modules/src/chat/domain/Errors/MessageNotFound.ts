/**
 * A message this organization does not have.
 *
 * The same refusal whether it never existed, belongs to another tenant, or was already deleted — the reasoning
 * `RoomNotFound` spells out: distinguishing them would let a caller probe ids across organizations by watching
 * which error comes back.
 */
import { Schema } from "effect"

export class MessageNotFound extends Schema.TaggedError<MessageNotFound>()("MessageNotFound", {
  messageId: Schema.String
}) {}
