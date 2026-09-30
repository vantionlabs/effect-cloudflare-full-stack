/**
 * The public contract for asking the corpus a question.
 *
 * `POST`, not `GET`, even though it reads: the question goes in a body because it is long-form text, it is not
 * cacheable (the answer depends on the corpus and the model), and a `GET` with a question in the query string
 * would put user text into every access log in front of the Worker.
 */
import { Authenticated } from "@ea/domain/Identity"
import { wire, wireFrom } from "@ea/modules/shared/domain/Wire"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { AskAnswer } from "./AskRpcs.ts"

/**
 * An answer, with the two numbers that say how much to trust it.
 *
 * `truncated` is published because it is the difference between an answer and a partial one: the step bound
 * stopped the loop, so a client must say so rather than presenting it as complete.
 */
export const AskAnswerV1 = wireFrom(AskAnswer, ["answer", "steps", "truncated"])

export const AskGroup = HttpApiGroup.make("ask")
  .add(
    HttpApiEndpoint.post("question", "/ask", {
      payload: wire({ question: Schema.String }),
      success: AskAnswerV1
    })
  )
  .middleware(Authenticated)
