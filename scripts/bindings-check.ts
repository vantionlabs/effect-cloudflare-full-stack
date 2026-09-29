#!/usr/bin/env bun
/**
 * Asserts every Wrangler environment declares the same bindings as the top level.
 *
 * Cloudflare does NOT inherit bindings into named environments:
 *
 *   "Non-inheritable keys are configurable at the top-level, but cannot be inherited by
 *    environments and must be specified for each environment."
 *
 * So adding a binding at the top level and forgetting it in `env.production` produces a
 * Worker that **deploys successfully and fails at runtime** — the worst shape of error,
 * because nothing in the deploy pipeline objects. This check closes that gap.
 *
 * It compares binding *names*, not ids: ids are expected to differ per environment (that is
 * the entire point), while a missing name is always a mistake.
 *
 * **Second check: does every resource Pulumi creates actually get bound?** Different failure, same class of
 * silence. `infra/index.ts` created a `WorkersKvNamespace` for the better-auth session cache and exported
 * its id, while `wrangler.jsonc` had no `kv_namespaces` block and no code read one — so the namespace was
 * billed, the plan described a cache, and every session lookup went to Postgres. Nothing objected, because
 * the two files were each internally consistent. See docs/services.md §3.
 *
 *   bun scripts/bindings-check.ts
 */
import { readFileSync } from "node:fs"

/** Binding keys that are non-inheritable per Cloudflare's configuration reference. */
const BINDING_KEYS = [
  "hyperdrive",
  "d1_databases",
  "r2_buckets",
  "kv_namespaces",
  "queues",
  "durable_objects",
  "vectorize",
  "services",
  "analytics_engine_datasets",
  "ai"
] as const

const configPath = new URL("../apps/worker/wrangler.jsonc", import.meta.url).pathname

/** Strips comments so JSONC parses as JSON. Strings are respected so URLs survive. */
const stripComments = (source: string): string => {
  let out = ""
  let inString = false
  let inLine = false
  let inBlock = false
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!
    const next = source[i + 1]
    if (inLine) {
      if (c === "\n") {
        inLine = false
        out += c
      }
      continue
    }
    if (inBlock) {
      if (c === "*" && next === "/") {
        inBlock = false
        i++
      }
      continue
    }
    if (inString) {
      out += c
      if (c === "\\") out += source[++i] ?? ""
      else if (c === "\"") inString = false
      continue
    }
    if (c === "\"") {
      inString = true
      out += c
      continue
    }
    if (c === "/" && next === "/") {
      inLine = true
      i++
      continue
    }
    if (c === "/" && next === "*") {
      inBlock = true
      i++
      continue
    }
    out += c
  }
  // Trailing commas are legal in JSONC and not in JSON.
  return out.replace(/,(\s*[}\]])/g, "$1")
}

interface Config {
  readonly name?: string
  readonly env?: Record<string, Record<string, unknown>>
  readonly [key: string]: unknown
}

const config = JSON.parse(stripComments(readFileSync(configPath, "utf8"))) as Config

/** Binding names declared under one config scope, e.g. ["hyperdrive:HYPERDRIVE"]. */
const bindingNames = (scope: Record<string, unknown>): Set<string> => {
  const names = new Set<string>()
  for (const key of BINDING_KEYS) {
    const value = scope[key]
    /*
     * THREE shapes, and each of the last two was a real hole in this check when it was missing.
     *
     *   array            `"r2_buckets": [{ binding }]`              — most bindings
     *   single object    `"ai": { binding }`                        — ai, browser
     *   nested arrays    `"queues": { producers: [], consumers: [] }`
     *
     * The failure mode is identical in all three and is why this script exists: a binding present at the
     * top level and absent from `env.production` **deploys fine and throws at runtime**. An earlier
     * version walked only arrays, so `ai` passed silently; the version after that reported
     * `queues:undefined`, which is worse than a miss because it looks like a name.
     */
    const entries: Array<Record<string, unknown>> = Array.isArray(value)
      ? value as Array<Record<string, unknown>>
      : typeof value === "object" && value !== null
      ? Object.values(value as Record<string, unknown>).some(Array.isArray)
        // Nested: walk the array-valued properties rather than the wrapper.
        ? Object.values(value as Record<string, unknown>).flatMap((nested) =>
          Array.isArray(nested) ? nested as Array<Record<string, unknown>> : []
        )
        : [value as Record<string, unknown>]
      : []

    for (const entry of entries) {
      /*
       * The BINDING name, not the resource name — and the distinction matters.
       *
       * A binding name is what the Worker's code refers to (`env.EVENTS`), so it must be identical in
       * every environment or the code breaks. A resource name is deliberately environment-suffixed
       * (`effect-ai-events-staging`), so comparing those across environments would fail on every
       * correctly-configured file. An earlier version compared `entry["queue"]` and reported
       * `queues:effect-ai-events-dev`, which looked like a binding name and was not one.
       *
       * A queue CONSUMER has no binding — it is a subscription, not a capability the code names. It is
       * recorded as `queues:<consumer>` so that a consumer missing from one environment is still caught,
       * without pinning the queue's name.
       */
      const binding = entry["binding"]
      if (typeof binding === "string") {
        names.add(`${key}:${binding}`)
      } else if (key === "queues" && typeof entry["queue"] === "string") {
        names.add("queues:<consumer>")
      } else {
        const fallback = entry["database_name"] ?? entry["bucket_name"] ?? entry["queue"]
        if (typeof fallback === "string") names.add(`${key}:${fallback}`)
      }
    }
  }
  return names
}

const expected = bindingNames(config as Record<string, unknown>)
const environments = Object.entries(config.env ?? {})

if (environments.length === 0) {
  console.log("✓ no named environments declared; nothing to compare")
  process.exit(0)
}

const failures: Array<string> = []

for (const [envName, envConfig] of environments) {
  const actual = bindingNames(envConfig)
  for (const name of expected) {
    if (!actual.has(name)) {
      failures.push(
        `env.${envName} is missing "${name}"\n` +
          `    It exists at the top level but bindings are NOT inherited, so the deployed\n` +
          `    Worker "${config.name}-${envName}" would not have it — and would still deploy.`
      )
    }
  }
}

if (failures.length > 0) {
  console.error(`✗ ${failures.length} missing binding declaration(s):\n`)
  for (const failure of failures) console.error(`  ${failure}\n`)
  process.exit(1)
}

console.log(
  `✓ bindings consistent across ${environments.length} environment(s) ` +
    `(${expected.size} binding${expected.size === 1 ? "" : "s"}: ${[...expected].join(", ")})`
)

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Check 2: Pulumi resources versus Wrangler bindings
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Pulumi resource type → the Wrangler key that binds it.
 *
 * Checked at the level of the KIND, not the individual resource, and that is deliberate: the DLQ is a real
 * `Queue` with no binding of its own (it is referenced as `dead_letter_queue`), so a per-resource check
 * would report it forever. "Pulumi creates queues, therefore Wrangler must bind a queue" is the invariant
 * that holds.
 */
const RESOURCE_TO_BINDING: Record<string, string> = {
  R2Bucket: "r2_buckets",
  WorkersKvNamespace: "kv_namespaces",
  Queue: "queues",
  HyperdriveConfig: "hyperdrive",
  D1Database: "d1_databases",
  VectorizeIndex: "vectorize"
}

/**
 * Pulumi resources that are legitimately NOT bindings, with the reason.
 *
 * Listed explicitly rather than left out of `RESOURCE_TO_BINDING`, because "absent from a map" is
 * indistinguishable from "forgotten". A reader should be able to tell that a resource was considered.
 */
const RESOURCE_NEEDS_NO_BINDING: Record<string, string> = {
  AiGateway: "reached through the `ai` binding's gateway option, or a gateway URL — not a binding of its own",
  AiGatewayDynamicRouting: "configuration on a gateway",
  R2CustomDomain: "configuration on a bucket",
  PagesProject: "a separate deploy target, not a binding of the API Worker. Its own bindings live in " +
    "apps/console/wrangler.jsonc, which `wrangler pages deploy` reads"
}

/**
 * Bindings that legitimately have no Pulumi resource, with the reason.
 *
 * `ai` is the interesting one and the shape to aim for: the binding IS the authorisation. No account id,
 * no token, no resource — which is why adopting Workers AI for embeddings required no infrastructure
 * change at all.
 */
const NEEDS_NO_RESOURCE: Record<string, string> = {
  ai: "the binding is the authorisation; Workers AI has no resource to create",
  durable_objects: "defined by the Worker's own exported class plus a migration, not by a resource",
  services: "a reference to another Worker, which is deployed rather than provisioned",
  analytics_engine_datasets: "a dataset is created implicitly on first write",
  hyperdrive: "managed OUTSIDE Pulumi, deliberately: the origin password cannot be read back, so any declaration " +
    "either shows a permanent false diff or overwrites the live password on every `up`. `pulumi preview` " +
    "proved it — it wanted to repoint the cached config's user from pscale_api_* to postgres.*. See " +
    "infra/index.ts. The ids live in wrangler.jsonc and `bun run db:verify` guards the seam instead"
}

const infraPath = new URL("../infra/index.ts", import.meta.url).pathname
const infraSource = readFileSync(infraPath, "utf8")

/*
 * Matches `new cloudflare.R2Bucket(` — a regex over source rather than evaluating the program, because
 * evaluating it would need Pulumi's engine and credentials, and this check has to run in CI on a fork.
 * The cost is that a resource created dynamically would be missed; there are none, and a comment is
 * cheaper than a runtime.
 */
const declaredKinds = new Set(
  [...infraSource.matchAll(/new\s+cloudflare\.([A-Za-z0-9_]+)\s*\(/g)].map((match) => match[1]!)
)

const boundKeys = new Set([...expected].map((name) => name.split(":")[0]!))
const mismatches: Array<string> = []

for (const kind of declaredKinds) {
  if (kind in RESOURCE_NEEDS_NO_BINDING) continue
  const key = RESOURCE_TO_BINDING[kind]
  /*
   * An unrecognised resource kind is REPORTED, not skipped.
   *
   * Skipping it is how this check would rot: someone adds a `VectorizeIndex` or a `D1Database`, the map
   * has no entry, and the check quietly approves. Naming it forces a one-line decision — either it maps
   * to a binding, or it is one of the kinds above that does not need one.
   */
  if (key === undefined) {
    mismatches.push(
      `infra/index.ts creates a ${kind}, which this check does not know about\n` +
        `    Add it to RESOURCE_TO_BINDING (if it needs a binding) or to RESOURCE_NEEDS_NO_BINDING\n` +
        `    (with the reason it does not). Silence here would mean an unbound resource passes.`
    )
    continue
  }
  if (!boundKeys.has(key)) {
    mismatches.push(
      `infra/index.ts creates a ${kind}, but wrangler.jsonc binds no "${key}"\n` +
        `    The resource is provisioned and billed, and no code can reach it. Either add the binding\n` +
        `    (and use it), or delete the resource — an unbound resource is a claim the code does not honour.`
    )
  }
}

for (const key of boundKeys) {
  if (key in NEEDS_NO_RESOURCE) continue
  const kinds = Object.entries(RESOURCE_TO_BINDING).filter(([, value]) => value === key).map(([kind]) => kind)
  if (kinds.length > 0 && !kinds.some((kind) => declaredKinds.has(kind))) {
    mismatches.push(
      `wrangler.jsonc binds "${key}", but infra/index.ts creates none of ${kinds.join(", ")}\n` +
        `    So the resource was made by hand and nobody can reproduce or review it. Declare it in Pulumi,\n` +
        `    or add it to NEEDS_NO_RESOURCE with the reason.`
    )
  }
}

if (mismatches.length > 0) {
  console.error(`\n✗ ${mismatches.length} infrastructure/binding mismatch(es):\n`)
  for (const mismatch of mismatches) console.error(`  ${mismatch}\n`)
  process.exit(1)
}

console.log(
  `✓ every Pulumi resource kind is bound, and every binding has a resource or a reason ` +
    `(${declaredKinds.size} resource kinds, ${boundKeys.size} binding kinds)`
)
