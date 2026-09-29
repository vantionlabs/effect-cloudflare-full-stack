/**
 * What executing a decision means, and the port that does it.
 *
 * The `Adapter` port is where this product touches the outside world — a ledger, a payment scheduler — so
 * it is the one place a mistake costs money rather than a wrong answer. Two fields exist for that reason
 * and would be much harder to add later.
 */
import { Schema } from "effect"

export const ExecutionId = Schema.String.pipe(Schema.brand("ExecutionId"))
export type ExecutionId = typeof ExecutionId.Type

/** What can be done with an approved decision. Closed: an unrecognised action must not be executable. */
export const ExecutionAction = Schema.Literals(["dry_run", "post_to_ledger", "schedule_payment"])
export type ExecutionAction = typeof ExecutionAction.Type

export const ExecutionStatus = Schema.Literals(["pending", "succeeded", "failed", "needs_attention"])
export type ExecutionStatus = typeof ExecutionStatus.Type

export class AdapterRequest extends Schema.Class<AdapterRequest>("AdapterRequest")({
  decisionId: Schema.String,
  action: ExecutionAction,
  /**
   * Passed to the provider as ITS dedupe key.
   *
   * The only real fix for the lost-completion window: if the recording write is lost after a successful
   * call, a retry with the same key is a no-op at the provider rather than a second payment. `DryRunAdapter`
   * ignores it, and it is in the interface anyway — an adapter written without it is unsafe with
   * auto-approve armed, and retrofitting means auditing every adapter that came before.
   */
  idempotencyKey: Schema.String,
  /** Everything the target system needs. Shape is the adapter's business. */
  payload: Schema.Unknown
}) {}

export class AdapterResponse extends Schema.Class<AdapterResponse>("AdapterResponse")({
  /** The target system's own reference, for reconciliation and for the reviewer's audit view. */
  reference: Schema.NullOr(Schema.String),
  detail: Schema.Unknown
}) {}
