/** No inbound message with this id in the event's organization. Terminal: a retry cannot bring it back. */
import { Schema } from "effect"

export class InboundMessageNotFound extends Schema.TaggedError<InboundMessageNotFound>()("InboundMessageNotFound", {
  inboundMessageId: Schema.String
}) {}
