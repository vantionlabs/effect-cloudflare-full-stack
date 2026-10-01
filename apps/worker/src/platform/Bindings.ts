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
import type { AssistantsBinding } from "@ea/modules/policy/server/Assistant"
import type { RoomsBinding } from "@ea/realtime/Server"
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
  /**
   * A SECOND Hyperdrive config against the same database, with query caching left ON.
   *
   * Only the policy corpus may be read through it. Hyperdrive caches reads for 60s and does not
   * invalidate on write, so the review queue and decision detail must keep using `HYPERDRIVE`, whose
   * config has caching disabled — a reviewer who approves something and then sees a stale queue is the
   * bug plan risk R3 names.
   *
   * **Declared but not yet consumed.** `Connect` is a single port today, so routing corpus reads
   * through this connection is a threading change in the retrieval path rather than a config edit.
   * Typed here so the binding that exists is the binding the code names, and so the next step is a
   * diff against a declaration instead of a discovery.
   */
  readonly HYPERDRIVE_CACHED: {
    readonly host: string
    readonly port: number
    readonly user: string
    readonly password: string
    readonly database: string
    readonly connectionString: string
  }
  /**
   * Realtime rooms: one Durable Object per organization, for fan-out only.
   *
   * The TYPE comes from the adapter that uses it (`RoomsBinding` in `realtime/server/Room`), not from a shape
   * restated here. That direction is what lets the adapter live in a module: this file composes what its
   * adapters ask for, instead of adapters depending on a list of everything the deployment has. Restating it
   * would be two declarations to keep in step, and the one that drifts is the one nothing checks.
   */
  readonly ROOMS: RoomsBinding

  /**
   * The reviewer's assistant: one Durable Object per conversation, for interaction state.
   *
   * The TYPE comes from the adapter that uses it (`AssistantsBinding` in `policy/server/Assistant`), the
   * same direction as `ROOMS` — this file composes what its adapters ask for, rather than adapters
   * depending on a list of everything the deployment has.
   *
   * **A conversation id must carry an organization component**, because one name is one instance and it
   * never moves (ADR-0018), so a name with no tenant in it lets one organization address another's
   * conversation. That is not left to this comment: the port's methods require `CurrentOrg`, so the adapter
   * composes the name from a tenant it was given rather than one a caller chose, and a handler that forgot
   * it does not compile. `ConversationId` separately forbids the separator, so an id cannot close its own
   * segment. The agent itself cannot help — it cannot validate the identity it is handed (ADR-0025).
   */
  readonly ASSISTANTS: AssistantsBinding

  /**
   * The decide pipeline as a Cloudflare Workflow (ADR-0024).
   *
   * Declared so the class is provisioned and reachable. **Nothing in production calls it yet** — the queue
   * still runs the pipeline inline through `DispatchEvent` — so this is the one binding here that is
   * deliberately unused, and `bindings:check` carries the reason rather than leaving it to be wondered
   * about. Flipping the queue over needs parsing to become the workflow's first step, because Workflow
   * params are persisted and a large document's text would approach the 1 MiB cap.
   *
   * Typed as the slice a caller uses. `create` is how an instance is started; the rest of the namespace's
   * surface (`get`, `terminate`) is not needed until there is something to administer.
   */
  readonly DECIDE: {
    readonly create: (
      options: { readonly id?: string | undefined; readonly params: unknown }
    ) => Promise<{ readonly id: string }>
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

  /**
   * Tier 3 parsing: Mistral OCR, for scanned documents.
   *
   * **Both or neither.** A key with no pinned model is a misconfiguration that fails loudly at layer build,
   * because a parser version defines the verbatim contract and `mistral-ocr-latest` would let a
   * provider-side upgrade change what verifies (plan risk R6). Absent means OCR is simply not a tier this
   * deployment has, which is the right default for something billed per page.
   *
   * A SECRET, not a var: `wrangler secret put MISTRAL_API_KEY`. It is absent from `wrangler.jsonc`
   * deliberately — an EU processor's key in a committed file is the kind of thing ADR-0006 exists to avoid.
   */
  readonly MISTRAL_API_KEY?: string | undefined
  /** The pinned OCR model, e.g. a dated `mistral-ocr-<yymm>`. Never `mistral-ocr-latest`. */
  readonly MISTRAL_OCR_MODEL?: string | undefined
  /**
   * Transactional email through Resend. Absent means the console stub, which logs every message — links
   * included — and sends nothing. That is the right default for a laptop and CI, and a WARN on every send makes
   * it visible if a real deployment is ever missing the key.
   *
   * **Both or neither**, for the same reason as Mistral's pair: `EMAIL_FROM` must be on a domain verified in
   * Resend, and a wrong one is accepted by the API and dropped downstream, so it has no safe default.
   *
   * A SECRET, not a var: `wrangler secret put RESEND_API_KEY`. `EMAIL_FROM` is not secret and may live in
   * `wrangler.jsonc` per environment once a sending domain is verified.
   */
  readonly RESEND_API_KEY?: string | undefined
  /** e.g. `Effect AI <noreply@mail.example.com>`. The domain must be verified in the Resend account. */
  readonly EMAIL_FROM?: string | undefined
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
