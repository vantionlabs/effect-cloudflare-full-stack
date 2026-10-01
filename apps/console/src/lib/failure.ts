/**
 * What a failed RPC says to the person.
 *
 * Every procedure fails with TAGGED errors (`QuoteNotInState`, `InvalidTerms`, …), and each tag has a different thing
 * for a person to do — so a page passes the sentences for the tags it can meet, and anything else falls back to the
 * tag itself rather than "unknown error". `_tag` first: a `Schema.TaggedError`'s `.message` is usually empty.
 */
import { Cause, Exit } from "effect"

interface Failure {
  readonly _tag: string
  readonly reason?: string
  readonly [key: string]: unknown
}

export type FailureMessages = Readonly<Record<string, string | ((failure: Failure) => string)>>

export const describeFailure = (exit: Exit.Exit<unknown, unknown>, messages: FailureMessages = {}): string => {
  if (Exit.isSuccess(exit)) return ""
  const found = Cause.findErrorOption(exit.cause as Cause.Cause<Partial<Failure>>)
  if (found._tag === "None" || typeof found.value._tag !== "string") return "Er ging iets mis. Probeer het opnieuw."
  const failure = found.value as Failure
  const message = messages[failure._tag]
  if (typeof message === "function") return message(failure)
  /*
   * No sentence for this tag: a Dutch generic one, with the tag in brackets so support can tell failures apart. NOT
   * `failure.reason` — reasons are written by the server in English, and an English sentence in a Dutch interface reads
   * as a bug.
   */
  return message ?? `Dat lukte niet (${failure._tag}). Probeer het opnieuw.`
}
