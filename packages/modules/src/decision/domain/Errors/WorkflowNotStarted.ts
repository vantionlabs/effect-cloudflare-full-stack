/**
 * The Workflow instance could not be created, so no work was started.
 *
 * **Deliberately NOT terminal.** Every other failure in this file describes work that was attempted and
 * cannot succeed on a retry; this one describes work that never began. A redelivery is exactly the right
 * response, which is why it is absent from `Terminal.ts`'s list — and why that absence is an assertion
 * rather than an oversight.
 *
 * It is distinct from a failure INSIDE the workflow, which the instance owns and records itself. This is
 * the narrow window where the queue has acked nothing and the instance does not exist.
 */
import { Schema } from "effect"

export class WorkflowNotStarted extends Schema.TaggedError<WorkflowNotStarted>()("WorkflowNotStarted", {
  eventId: Schema.String,
  reason: Schema.String
}) {}
