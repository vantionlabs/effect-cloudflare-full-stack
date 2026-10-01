/** No job with that id in the caller's organization. */
import { Schema } from "effect"

export class JobNotFound extends Schema.TaggedError<JobNotFound>()("JobNotFound", {
  jobId: Schema.String
}) {}
