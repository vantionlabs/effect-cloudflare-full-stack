/**
 * Identifier generation, as a port.
 *
 * A port so tests can be deterministic, and cross-slice because every table wants the same kind of
 * key. The implementation is a platform concern (it reaches for randomness) and lives with the
 * composition root; this file is the interface every caller sees.
 *
 * UUIDv7 is the intended shape: time-ordered, so a primary-key index stays append-mostly instead of
 * writing into random pages, and `order by id` is chronological without a second column. The review
 * queue is read in arrival order, so that ordering is load-bearing rather than incidental.
 */
import { Context, type Effect } from "effect"

export interface IdsService {
  readonly next: Effect.Effect<string>
}

export class Ids extends Context.Service<Ids, IdsService>()("platform/Ids") {}
