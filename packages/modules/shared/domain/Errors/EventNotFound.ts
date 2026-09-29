/**
 * The event row named by a message is gone. **Terminal**: there is nothing to read current state from.
 */
import { Schema } from "effect"

export class EventNotFound extends Schema.TaggedError<EventNotFound>()("EventNotFound", {
  eventId: Schema.String
}) {}
