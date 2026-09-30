/**
 * The document named by an event no longer exists. **Terminal** — it will not exist on retry.
 */
import { Schema } from "effect"

export class DocumentNotFound extends Schema.TaggedError<DocumentNotFound>()("DocumentNotFound", {
  documentId: Schema.String
}) {}
