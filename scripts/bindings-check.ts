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
    if (!Array.isArray(value)) continue
    for (const entry of value as Array<Record<string, unknown>>) {
      const name = entry["binding"] ?? entry["queue"] ?? entry["database_name"] ?? entry["bucket_name"]
      names.add(`${key}:${String(name)}`)
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
