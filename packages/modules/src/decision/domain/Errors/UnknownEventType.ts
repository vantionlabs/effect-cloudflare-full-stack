/**
 * An event type this build does not know. **Terminal**: a deploy fixes it, a retry cannot teach it.
 *
 * Defined in the decision slice rather than in the Worker that raises it: the Worker is a composition
 * root and an error is part of a contract — the terminal-versus-retryable classification in
 * `shared/domain/Errors/Terminal.ts` names this tag, and a slice's failures should be readable without
 * opening a deployment target.
 */
import { Schema } from "effect"

export class UnknownEventType extends Schema.TaggedError<UnknownEventType>()("UnknownEventType", {
  type: Schema.String
}) {}
