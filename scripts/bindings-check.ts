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
