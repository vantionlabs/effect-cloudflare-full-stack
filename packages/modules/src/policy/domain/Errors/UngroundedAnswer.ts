/**
 * The agent cited something it cannot support. The answer is refused, not weakened.
 *
 * **Why refusing beats returning the answer with the bad citation removed.** The prose relies on the claim;
 * stripping the citation leaves an assertion a reviewer reads as authoritative and cannot check, which is the
 * exact failure the decide path's rails exist to prevent. This product's claim is that it knows when it is not
 * allowed to answer — the chat surface has to make the same claim or it becomes the way around it.
 *
 * `reasons` names each failure in the reviewer's words, the way `railsFired` does, so the refusal is actionable
 * rather than a shrug.
 */
import { Schema } from "effect"

export class UngroundedAnswer extends Schema.TaggedError<UngroundedAnswer>()("UngroundedAnswer", {
  reasons: Schema.Array(Schema.String)
}) {}
