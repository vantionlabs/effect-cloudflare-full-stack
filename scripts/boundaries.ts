#!/usr/bin/env bun
/**
 * Enforces the slice × role architecture, so the layering is checked rather than remembered.
 *
 * Why a script and not dependency-cruiser: the rules here are about *which package* an import
 * comes from, and Bun workspaces already make that the primary boundary. Adding another tool
 * to restate what `package.json` dependencies express would be redundant. This catches the
 * things package boundaries cannot: forbidden specifiers, and per-directory rules inside a
 * package.
 *
 *   bun scripts/boundaries.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const root = new URL("..", import.meta.url).pathname

interface Rule {
  readonly label: string
  /** Files this rule applies to, relative to the repo root. */
  readonly appliesTo: (path: string) => boolean
  /** Import specifiers that must not appear. */
  readonly forbidden: ReadonlyArray<{ readonly pattern: RegExp; readonly because: string }>
  /** Escape hatch for rules that depend on the importer as well as the specifier. */
  readonly permitted?: (path: string, specifier: string) => boolean
}

/** `packages/<slice>/<role>/...` → `<slice>`, or undefined outside a slice package. */
const sliceOf = (path: string): string | undefined => path.startsWith("packages/") ? path.split("/")[1] : undefined

/** `@ea/<slice>-<role>` → `<slice>`, for the slices that exist as packages. */
const sliceOfSpecifier = (specifier: string): string | undefined =>
  /^@ea\/(iam|intake|decision|policy|shared)-/.exec(specifier)?.[1]

const rules: ReadonlyArray<Rule> = [
  {
    label: "infra stays free of Effect",
    appliesTo: (p) => p.startsWith("infra/"),
    forbidden: [
      {
        pattern: /^effect$|^effect\/|^@effect\//,
        because: "the Pulumi program shares nothing with the Worker, so depending on Effect would " +
          "buy no composition while exposing infrastructure to every RC churn — which is " +
          "precisely what blocked Alchemy"
      }
    ]
  },
  {
    label: "domain packages stay platform-free",
    appliesTo: (p) => p.startsWith("packages/") && p.includes("/domain/src/"),
    forbidden: [
      {
        // `effect/http` is the SERVER runtime. `effect/http-api` is deliberately allowed: it
        // is a declarative contract DSL, and the whole point of putting the contract in a
        // domain package is that the browser client derives from the same declaration the
        // handlers are typed by. Whether server-only symbols leak into the client bundle is
        // a tree-shaking question, answered by the bundle assertion, not by this rule.
        pattern: /^effect\/http$|^effect\/http\//,
        because: "domain must not import the HTTP server runtime (effect/http-api is fine)"
      },
      { pattern: /^effect\/sql/, because: "domain must not know about persistence" },
      { pattern: /^@effect\/sql-/, because: "domain must not know about a database driver" },
      { pattern: /^cloudflare:/, because: "domain must be runnable in Node and the browser" },
      { pattern: /^node:/, because: "domain must be importable by the browser" },
      { pattern: /^@effect\/ai-/, because: "domain must not bind to an AI provider" }
    ]
  },
  {
    label: "the Worker never imports Bun platform packages",
    appliesTo: (p) => p.startsWith("apps/worker/src/"),
    forbidden: [
      {
        pattern: /^@effect\/platform-bun/,
        because: "the deployed Worker runs on workerd, not Bun; Bun is the toolchain only"
      },
      {
        pattern: /^@effect\/platform-node/,
        because: "the deployed Worker runs on workerd, not Node"
      }
    ]
  },
  {
    label: "nothing but the composition root may reach into a server ring",
    appliesTo: (p) =>
      p.startsWith("packages/") ||
      (p.startsWith("apps/worker/src/") && p !== "apps/worker/src/Main.ts"),
    forbidden: [
      {
        pattern: /^@ea\/[a-z-]+-server(\/|$)/,
        because: "an adapter may only be named by the composition root. A use case or another " +
          "slice that imports one has bound itself to a platform, and the fakes-only test tier " +
          "stops being possible"
      }
    ]
  },
  {
    label: "tables rings stay driver-free",
    appliesTo: (p) => p.startsWith("packages/") && p.includes("/tables/src/"),
    forbidden: [
      {
        pattern: /^@effect\/sql-/,
        because: "a migration must run against whatever client the caller has — the Worker's " +
          "Hyperdrive one in production, a plain one in the eval harness. Naming a driver here " +
          "would tie the schema to the deployment"
      },
      { pattern: /^cloudflare:/, because: "migrations must be runnable from Node" }
    ]
  },
  {
    label: "a slice never reaches into another slice",
    appliesTo: (p) => p.startsWith("packages/"),
    forbidden: [
      {
        pattern: /^@ea\//,
        because: "slices compose through `shared`, never directly. A genuinely cross-slice type " +
          "belongs in shared/domain (as Identity and Authenticated do); anything else is a " +
          "boundary that has not been thought about yet"
      }
    ],
    // Permitted: within your own slice, and anything depending on `shared`. Plus the two
    // composition points, which exist precisely to name every slice — `shared/api` composes the
    // groups into one contract, and `Migrations.ts` is the one place migration order is decided.
    permitted: (path, specifier) => {
      if (path.startsWith("packages/shared/api/")) return true
      if (path === "packages/shared/tables/src/Database/Migrations.ts") return true
      const target = sliceOfSpecifier(specifier)
      return target === undefined || target === "shared" || target === sliceOf(path)
    }
  },
  {
    label: "only the platform directory may open sockets or touch the driver",
    appliesTo: (p) => p.startsWith("apps/worker/src/") && !p.includes("/platform/"),
    forbidden: [
      {
        pattern: /^cloudflare:sockets$/,
        because: "socket handling belongs in platform/CloudflareSocket.ts"
      },
      {
        pattern: /^@effect\/sql-pg$/,
        because: "the Postgres driver belongs in platform/HyperdriveConnect.ts, which owns connection lifetime"
      }
    ]
  }
]

const walk = (dir: string): Array<string> => {
  const out: Array<string> = []
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (/\.tsx?$/.test(entry)) out.push(path)
  }
  return out
}

const importPattern = /(?:from|import)\s+"([^"]+)"/g

const failures: Array<string> = []
let checked = 0

for (const dir of ["packages", "apps", "infra"]) {
  for (const absolute of walk(join(root, dir))) {
    const path = relative(root, absolute)
    if (path.includes("/test/")) continue
    const source = readFileSync(absolute, "utf8")
    const specifiers = [...source.matchAll(importPattern)].map((m) => m[1]!)

    for (const rule of rules) {
      if (!rule.appliesTo(path)) continue
      checked++
      for (const specifier of specifiers) {
        if (rule.permitted?.(path, specifier) === true) continue
        for (const { pattern, because } of rule.forbidden) {
          if (pattern.test(specifier)) {
            failures.push(`${path}\n    imports "${specifier}"\n    ${because}\n    rule: ${rule.label}`)
          }
        }
      }
    }
  }
}

// Exactly one place may emit a decision.execute event, so the auto-approve path and the human
// approve path provably share one execution path. Asserted here because it is the central
// architectural claim and a second call site would silently break it.
// (Enabled once the event engine lands at build-order step 8.)

if (failures.length > 0) {
  console.error(`✗ ${failures.length} boundary violation(s):\n`)
  for (const failure of failures) console.error(`  ${failure}\n`)
  process.exit(1)
}

console.log(`✓ boundaries clean (${checked} file-rule checks)`)
