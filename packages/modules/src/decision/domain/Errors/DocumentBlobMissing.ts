/**
 * The stored bytes for a document are gone. **Terminal** — no retry brings a deleted object back.
 *
 * Defined in the decision slice rather than in the Worker that raises it: the Worker is a composition
 * root and an error is part of a contract — the terminal-versus-retryable classification in
 * `shared/domain/Errors/Terminal.ts` names this tag, and a slice's failures should be readable without
 * opening a deployment target.
 */
import { Schema } from "effect"

export class DocumentBlobMissing extends Schema.TaggedError<DocumentBlobMissing>()("DocumentBlobMissing", {
  documentId: Schema.String,
  r2Key: Schema.String
}) {}
