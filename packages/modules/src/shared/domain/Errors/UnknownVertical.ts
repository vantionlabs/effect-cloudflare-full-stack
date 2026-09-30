/**
 * No extraction schema is registered for this vertical. **Terminal** — a deploy fixes it, a retry does not.
 */
import { Schema } from "effect"

export class UnknownVertical extends Schema.TaggedError<UnknownVertical>()("UnknownVertical", {
  vertical: Schema.String
}) {}
