/**
 * The execution port: the boundary where a decision becomes an action in someone else's system.
 *
 * Two methods, and the optional one is the interesting half.
 *
 * `execute` does the thing. `lookup` asks the target system **what actually happened** for a given
 * idempotency key — which is the only way to resolve the window this product cannot close: the adapter
 * call succeeded and the recording write was lost. Without `lookup` a stuck `pending` can only be handed
 * to a human; with it, reconciliation can ask and find out.
 *
 * It is optional because not every target system can answer. That optionality is load-bearing rather than
 * lazy: `lookup === undefined` is precisely the signal that an adapter cannot be trusted with
 * auto-approval, and ADR-0013 turns that into a rule.
 */
import { Context, type Effect, type Option } from "effect"
import type { AdapterRequest, AdapterResponse } from "./Execution.model.ts"

export interface AdapterService {
  /** A name recorded on the execution row, so an audit says which adapter acted. */
  readonly name: string
  /**
   * Whether the target system honours `idempotencyKey` as its own dedupe key.
   *
   * False means a retry after a lost completion can act twice. ADR-0013: such an adapter may not be
   * enabled for a customer with auto-approve armed.
   */
  readonly providerIdempotent: boolean
  readonly execute: (request: AdapterRequest) => Effect.Effect<AdapterResponse, AdapterFailed>
  /** Asks the target what happened for a key. Absent when the target cannot answer. */
  readonly lookup?: (idempotencyKey: string) => Effect.Effect<Option.Option<AdapterResponse>>
}

/** The adapter call failed. Whether it failed BEFORE or AFTER acting is exactly what we cannot know. */
export class AdapterFailed extends Error {
  readonly _tag = "AdapterFailed"
}

export class Adapter extends Context.Service<Adapter, AdapterService>()("decision/Adapter") {}
