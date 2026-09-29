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
import { ConfigProvider, Context, type Layer } from "effect"

/** Bindings and vars this Worker declares. Extended as alchemy.run.ts provisions more. */
export interface Env {
  readonly HYPERDRIVE: {
    readonly host: string
    readonly port: number
    readonly user: string
    readonly password: string
    readonly database: string
    /** Assembled by the binding. Used by `pg` for better-auth; the Effect driver takes parts. */
    readonly connectionString: string
  }
  /** Source documents. Tenancy is a key prefix, enforced in @ea/modules/intake/domain/Document. */
  readonly DOCUMENTS: R2Bucket
  /** The event queue producer. Stable for an isolate's lifetime, so safe to capture. */
  readonly EVENTS: { readonly send: (body: unknown) => Promise<void> }
  /**
   * Workers AI. **The binding IS the authorisation** — no account id, no token, no egress.
   *
   * Declared in `wrangler.jsonc` since the embedder was written, and absent from this interface until the
   * decide pipeline was wired, which is exactly why the deployed Worker could not decide anything: the
   * binding existed, nothing could reach it, and `bindings:check` had no way to notice
   * (docs/services.md §3.1).
   *
   * Structurally typed rather than `Ai` from `@cloudflare/workers-types`, matching the two adapter
   * interfaces it satisfies. `options` carries the AI Gateway id, which is how the binding transport
   * reaches a gateway — it cannot be pointed at a gateway hostname the way a REST call can.
   */
  readonly AI: {
    readonly run: (
      model: string,
      input: Record<string, unknown>,
      options?: { readonly gateway?: { readonly id: string } } | undefined
    ) => Promise<unknown>
  }
  /**
   * The read-through cache. See `shared/domain/Cache/Cache.ts` for the rule about what may live here —
   * the key must make staleness impossible, because KV has no invalidation and no atomic primitives.
   *
   * NOT better-auth's session store: `secondaryStorage` requires atomic `getAndDelete` and `increment`,
   * and backing those with KV would silently break rate limiting (`BetterAuth.ts`).
   */
  readonly CACHE: {
    readonly get: (key: string) => Promise<string | null>
    readonly put: (
      key: string,
      value: string,
      options?: { readonly expirationTtl?: number } | undefined
    ) => Promise<void>
  }
  /**
   * Analytics Engine, for the product's own rates — groundedRate, per-rail fire rates, cost per decision.
   *
   * Created implicitly on first write, so there is no resource to provision. `writeDataPoint`'s three arrays
   * are positional and their order IS the schema: append only, never reorder. See `TelemetryAnalytics.ts`.
   */
  readonly METRICS?: {
    readonly writeDataPoint: (point: {
      readonly blobs?: ReadonlyArray<string> | undefined
      readonly doubles?: ReadonlyArray<number> | undefined
      readonly indexes?: ReadonlyArray<string> | undefined
    }) => void
  }
  /**
   * An OTLP endpoint, when one is configured. Absent means spans are created and discarded.
   *
   * The spans already exist — `Activity`, `effect/sql`, `LanguageModel` and `RpcServer` all create them — so
   * this is the drain, not the instrumentation.
   */
  /**
   * The console's origin, when the API is on its own subdomain.
   *
   * Set it and three things turn on together — CORS, better-auth's `trustedOrigins`, and the cookie domain —
   * because a deployment with two of the three produces "login works and then I am logged out", with nothing
   * in the logs. Absent means same-origin: local `vite dev`, or the Pages Function proxy.
   */
  readonly CONSOLE_ORIGIN?: string | undefined
  /** `.example.com`, when the console and the API are sibling subdomains. */
  readonly COOKIE_DOMAIN?: string | undefined
  readonly OTLP_ENDPOINT?: string | undefined
  /** `k=v,k=v` auth headers for the OTLP endpoint. A secret. */
  readonly OTLP_HEADERS?: string | undefined
  /** The AI Gateway id, when one is configured. Absent means direct, unmetered, uncached model calls. */
  readonly AI_GATEWAY?: string | undefined
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
const configProviderFrom = (env: Env): ConfigProvider.ConfigProvider => {
  const record: Record<string, string | undefined> = { ...process.env }
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") record[key] = value
  }
  return ConfigProvider.fromEnvRecord(record)
}

export const layerConfigProvider = (env: Env): Layer.Layer<never> => ConfigProvider.layer(configProviderFrom(env))
