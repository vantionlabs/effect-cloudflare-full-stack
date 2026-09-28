/**
 * The Worker's environment, and the two doors it comes through.
 *
 * Workers hand you `env` and `ctx` per invocation, but Effect layers want to be built
 * once. The split here is deliberate:
 *
 * - `Bindings` holds `env`, which is **stable for an isolate's lifetime** (binding stubs,
 *   vars and secrets), so the layer graph that depends on it is memoised per isolate.
 * - `WorkerCtx` holds `ExecutionContext`, which is **genuinely per-invocation** and must
 *   never be cached — caching it would make `waitUntil` write into a dead request.
 *
 * Both are `Context.Service` with no default rather than `Context.Reference`: a default
 * value for "the database bindings" is a bug that compiles. Absence must be a type error.
 */
import { ConfigProvider, Context, Effect, type Layer } from "effect"

/** Bindings and vars this Worker declares. Extended as alchemy.run.ts provisions more. */
export interface Env {
  readonly HYPERDRIVE: {
    readonly host: string
    readonly port: number
    readonly user: string
    readonly password: string
    readonly database: string
  }
  readonly VERSION?: string | undefined
}

export class Bindings extends Context.Service<Bindings, Env>()("app/Bindings") {}

/**
 * The per-invocation `ExecutionContext`.
 *
 * SAFE TO MEMOISE in `Bindings`: D1/R2/KV/Hyperdrive/queue-producer stubs, vars, secrets.
 * NOT SAFE, and therefore here instead: `ExecutionContext`, and any future per-request
 * stub (a service binding, a Durable Object stub obtained per request).
 */
export class WorkerCtx extends Context.Service<WorkerCtx, ExecutionContext>()("app/WorkerCtx") {}

/**
 * Makes `Config` work on Workers.
 *
 * There is no `process.env` for secrets here — they arrive as properties on `env`. So the
 * bindings are turned into a `ConfigProvider` explicitly; `fromEnvRecord` exists for
 * exactly this ("for explicit records in restricted runtimes"). Bindings win over
 * `process.env` so a local `.env` cannot shadow a deployed secret.
 *
 * Only string-valued entries become config: a binding stub is an object and is reached
 * through `Bindings`, not through `Config`.
 */
export const configProviderFrom = (env: Env): ConfigProvider.ConfigProvider => {
  const record: Record<string, string | undefined> = { ...process.env }
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") record[key] = value
  }
  return ConfigProvider.fromEnvRecord(record)
}

export const layerConfigProvider = (env: Env): Layer.Layer<never> => ConfigProvider.layer(configProviderFrom(env))

/**
 * Runs an effect as fire-and-forget work that outlives the response.
 *
 * Without `ctx.waitUntil` a Worker may be torn down the moment the response is returned,
 * silently dropping in-flight work.
 *
 * `R` is deliberately `never`: the caller must provide every service the task needs
 * *before* handing it over, rather than the task inheriting the request's context. Ambient
 * inheritance would let background work capture request-scoped services that die with the
 * request — precisely the bug `waitUntil` exists to avoid.
 *
 * Failures are logged rather than swallowed: a dropped background task that reports nothing
 * is worse than a slow one.
 */
export const runFireAndForget = <A, E>(
  effect: Effect.Effect<A, E>
): Effect.Effect<void, never, WorkerCtx> =>
  Effect.flatMap(WorkerCtx, (ctx) =>
    Effect.sync(() => {
      ctx.waitUntil(
        Effect.runPromiseExit(
          effect.pipe(
            Effect.tapCause((cause) => Effect.logError("Fire-and-forget task failed", cause))
          )
        )
      )
    }))
