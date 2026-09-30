/**
 * A channel name that leaves nothing to address it by.
 *
 * Names become slugs, and a name made entirely of punctuation or emoji slugifies to the empty string. The
 * alternative to refusing is a channel with an unaddressable identity, which fails later and further away —
 * at a unique index, or in a URL.
 */
import { Schema } from "effect"

export class RoomNameInvalid extends Schema.TaggedError<RoomNameInvalid>()("RoomNameInvalid", {
  name: Schema.String,
  reason: Schema.String
}) {}
