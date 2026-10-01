/**
 * The provider refused or could not be reached.
 *
 * `reason` is the provider's own words where there are any, because the useful ones are specific — an
 * unverified sending domain and a malformed address fail the same way to a type and differently to a person.
 *
 * **Not in `Terminal.ts`, on purpose.** Nothing in the event pipeline sends mail, so this error never reaches
 * the terminal-versus-retryable classification; the auth flows that raise it log and carry on, because a user
 * who cannot be emailed a reset link must still get a response rather than a 500.
 */
import { Schema } from "effect"

export class EmailNotSent extends Schema.TaggedError<EmailNotSent>()("EmailNotSent", {
  to: Schema.String,
  reason: Schema.String
}) {}
