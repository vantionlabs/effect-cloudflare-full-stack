/** The job is not in the state the step needs — already completed or invoiced, perhaps by someone else. */
import { Schema } from "effect"

export class JobNotInState extends Schema.TaggedError<JobNotInState>()("JobNotInState", {
  jobId: Schema.String
}) {}
