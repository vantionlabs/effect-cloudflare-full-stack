/**
 * A channel that has been closed to new messages.
 *
 * Actionable, which is why it is typed rather than a defect: the caller can un-archive it or post elsewhere.
 * It exists at all because archiving is reversible and non-destructive — everything said in the channel stays
 * readable, so "you cannot post here" is the only thing archiving actually enforces.
 */
import { Schema } from "effect"

export class RoomArchived extends Schema.TaggedError<RoomArchived>()("RoomArchived", {
  roomId: Schema.String
}) {}
