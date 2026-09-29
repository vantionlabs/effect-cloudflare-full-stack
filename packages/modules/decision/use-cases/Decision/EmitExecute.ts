/**
 * The ONE place a `decision.execute` event is emitted.
 *
 * Both the human approval path and the auto-approve branch of the router call this. `bun run dep:check`
 * asserts there is exactly **one** call site, because that grep is the only mechanical guarantee that the
 * two paths really converge — a second emit would look harmless and would quietly mean "automatic" and
 * "approved" are two features that happen to resemble each other.
 *
 * Thin on purpose. Its whole content is the derived key, which is the same key the `executions` row claims
 * under, so a retry at either layer lands on one identity.
 */
import type { ExecutionAction } from "@ea/modules/decision/domain/Execution"
import { executeEventKey } from "@ea/modules/shared/domain/Event"
import { EmitEvent } from "@ea/modules/shared/use-cases/Event"

export const EmitExecute = (options: {
  readonly decisionId: string
  readonly action: ExecutionAction
}) =>
  EmitEvent({
    type: "decision.execute",
    idempotencyKey: executeEventKey(options.decisionId, options.action),
    payload: { decisionId: options.decisionId, action: options.action }
  })
