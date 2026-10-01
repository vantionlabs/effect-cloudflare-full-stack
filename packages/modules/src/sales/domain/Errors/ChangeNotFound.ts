/** No proposal with that id in the caller's organization — which is also the answer for another tenant's id. */
import { Schema } from "effect"

export class ChangeNotFound extends Schema.TaggedError<ChangeNotFound>()("ChangeNotFound", {
  changeId: Schema.String
}) {}
