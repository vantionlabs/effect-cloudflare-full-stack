/**
 * The public contract for asking the corpus a question.
 *
 * `POST`, not `GET`, even though it reads: the question goes in a body because it is long-form text, it is not
 * cacheable (the answer depends on the corpus and the model), and a `GET` with a question in the query string
 * would put user text into every access log in front of the Worker.
 */
import { Authenticated } from "@ea/domain/Identity"
import { AskableCollection } from "@ea/modules/shared/domain/Corpus"
import { pickFields, wire, wireFrom } from "@ea/modules/shared/domain/Wire"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { AskAnswer, AskAnswerCitation } from "./AskAnswer.ts"

/**
 * An answer, with the two numbers that say how much to trust it.
 *
 * `truncated` is published because it is the difference between an answer and a partial one: the step bound
 * stopped the loop, so a client must say so rather than presenting it as complete.
 */
export const AskCitationV1 = wireFrom(AskAnswerCitation, ["chunk_id", "clause_ref", "excerpt", "heading", "document"])

export const AskAnswerV1 = wire({
  ...pickFields(AskAnswer.fields, ["answer", "steps", "truncated"]),
  /** Published because a reviewer has to be able to check the answer — the same argument as a decision's. */
  citations: Schema.Array(AskCitationV1)
})

/**
 * **422**, because the request was fine and the answer was not.
 *
 * Not a 500: nothing failed. Not a 200 with a warning field either — a caller that forgets to read a flag gets
 * an unverifiable claim, and this refusal exists precisely because such a claim reads as authoritative. The
 * reasons are published so a reviewer sees which clause could not be supported, the way `rails_fired` does.
 */
export class UngroundedAnswerV1 extends Schema.Error<UngroundedAnswerV1>(
  "UngroundedAnswerV1"
)({ _tag: Schema.tag("UngroundedAnswerV1"), reasons: Schema.Array(Schema.String) }, { httpApiStatus: 422 }) {}

export const AskGroup = HttpApiGroup.make("ask")
  .add(
    HttpApiEndpoint.post("question", "/ask", {
      payload: wire({
        question: Schema.String,
        /** Which corpus to ask. Omitted means `policy`, so existing callers are unchanged. */
        collection: Schema.optional(AskableCollection)
      }),
      success: AskAnswerV1,
      error: UngroundedAnswerV1
    })
  )
  .middleware(Authenticated)
