/**
 * The `Ids` adapter.
 *
 * Uses the `uuid` package rather than assembling the bytes here. An earlier version hand-rolled the
 * v7 layout — 48-bit timestamp, version nibble, RFC 9562 variant bits — which is precisely the wrong
 * place to be clever: a bit-twiddling mistake produces identifiers that look fine, sort subtly
 * wrong, and collide rarely enough to reach production.
 */
import { Ids } from "@ea/shared-domain/Ids"
import { Effect, Layer } from "effect"
import { v7 as uuidv7 } from "uuid"

export const IdsUuid: Layer.Layer<Ids> = Layer.succeed(Ids)({ next: Effect.sync(() => uuidv7()) })
