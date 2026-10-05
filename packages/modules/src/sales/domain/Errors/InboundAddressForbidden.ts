/** Only an owner or an admin may create or rotate the organization's receiving address. */
import { Schema } from "effect"

export class InboundAddressForbidden extends Schema.TaggedError<InboundAddressForbidden>()("InboundAddressForbidden", {
  role: Schema.String
}) {}
