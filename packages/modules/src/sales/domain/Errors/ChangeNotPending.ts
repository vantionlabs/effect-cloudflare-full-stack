/** The proposal was already applied or rejected — by someone else, or a second click. */
import { Schema } from "effect"

export class ChangeNotPending extends Schema.TaggedError<ChangeNotPending>()("ChangeNotPending", {
  changeId: Schema.String
}) {}
