/**
 * The `Connect` adapter: a Postgres connection over Hyperdrive, for one unit of work.
 *
 * This is the only place in the repo that names a SQL driver, which `bun run dep:check` enforces.
 * Everything above it asks `Connect` for a connection and gets one scoped to the request — see
 * `@ea/modules/shared/tables`'s `Connect.ts` for why that scope is in the type rather than in a comment.
 */
import { Connect } from "@ea/database/Database"
import { PgClient } from "@effect/sql-pg"
import { Effect, Layer } from "effect"
import * as ReactivityModule from "effect/reactivity/Reactivity"
import { Bindings } from "./Bindings.ts"
import { pgConfigFor } from "./CloudflareSocket.ts"

/** Stateless and safe to memoise for the isolate, unlike the connection itself. */
export const ReactivityLive: Layer.Layer<ReactivityModule.Reactivity> = ReactivityModule.layer

export const ConnectHyperdrive: Layer.Layer<
  Connect,
  never,
  Bindings | ReactivityModule.Reactivity
> = Layer.effect(Connect)(
  Effect.gen(function*() {
    const env = yield* Bindings
    // Reactivity is stateless, so it is taken from the layer's context once and closed over.
    // Only the socket is per-request, which is what keeps `open`'s requirement down to `Scope`.
    const reactivity = yield* ReactivityModule.Reactivity
    return {
      open: Effect.provideService(
        PgClient.make(pgConfigFor(env.HYPERDRIVE)),
        ReactivityModule.Reactivity,
        reactivity
      )
    }
  })
)
