/**
 * Identifier generation, as a service so tests can be deterministic.
 *
 * UUIDv7 rather than v4: it is time-ordered, so a primary-key index stays append-mostly instead of
 * writing into random pages, and `order by id` is chronological without a second column. The
 * review queue is read in arrival order, so that ordering is load-bearing rather than incidental.
 *
 * Uses the `uuid` package rather than assembling the bytes here. An earlier version hand-rolled
 * the v7 layout — 48-bit timestamp, version nibble, RFC 9562 variant bits — which is precisely the
 * wrong place to be clever: a bit-twiddling mistake produces identifiers that look fine, sort
 * subtly wrong, and collide rarely enough to reach production.
 */
import { Context, Effect, Layer } from "effect"
import { v7 as uuidv7 } from "uuid"

export interface IdsService {
  readonly next: Effect.Effect<string>
}

export class Ids extends Context.Service<Ids, IdsService>()("platform/Ids") {}

export const IdsLive: Layer.Layer<Ids> = Layer.succeed(Ids)({ next: Effect.sync(() => uuidv7()) })
