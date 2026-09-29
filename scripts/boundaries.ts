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

const MODULES = "packages/modules/"

/** `packages/modules/<slice>/<role>/...` → `<slice>`, or undefined outside the modules package. */
const sliceOf = (path: string): string | undefined => path.startsWith(MODULES) ? path.split("/")[2] : undefined

/**
 * `packages/modules/<slice>/<role>/...` → `<role>`.
 *
 * The ring is a directory rather than a package now, so every rule that could once lean on a
 * package name keys on this instead — which makes this script the only thing keeping the rings
 * apart. See ADR-0011 for why that trade was taken.
 */
const ringOf = (path: string): string | undefined => path.startsWith(MODULES) ? path.split("/")[3] : undefined

/** `@ea/modules/<slice>/<role>/...` → `<slice>`. */
const sliceOfSpecifier = (specifier: string): string | undefined =>
  /^@ea\/modules\/(iam|intake|decision|policy|shared)\//.exec(specifier)?.[1]

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
    appliesTo: (p) => ringOf(p) === "domain",
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
      p.startsWith(MODULES) ||
      p.startsWith("packages/api/") ||
      (p.startsWith("apps/worker/src/") && p !== "apps/worker/src/Main.ts"),
    forbidden: [
      {
        pattern: /^@ea\/modules\/[a-z-]+\/server(\/|$)/,
        because: "an adapter may only be named by the composition root. A use case or another " +
          "slice that imports one has bound itself to a platform, and the fakes-only test tier " +
          "stops being possible. `evals/` is deliberately outside this rule: it is a composition " +
          "root of its own, and naming the deterministic embedder is the whole point of it"
      }
    ]
  },
  {
    label: "modules never depend on the api package",
    appliesTo: (p) => p.startsWith(MODULES),
    forbidden: [
      {
        pattern: /^@ea\/api(\/|$)/,
        because: "the api package COLLECTS the modules' groups, so the dependency runs api -> " +
          "modules and only that way. The reverse is a cycle, and it does not fail loudly: the " +
          "barrel re-exports the handler files, so `ApiV1` arrives undefined and every request " +
          "dies with `Cannot read properties of undefined (reading 'groups')`. Reach the manifest " +
          "by relative path from inside packages/api instead"
      }
    ]
  },
  {
    label: "the api package imports contracts and use cases, never adapters",
    appliesTo: (p) => p.startsWith("packages/api/"),
    forbidden: [
      {
        pattern: /^@effect\/sql-|^cloudflare:|^pg$/,
        because: "the transport edge calls use cases; it does not own connections or bindings. " +
          "Those belong to apps/worker/src/platform"
      }
    ]
  },
  {
    label: "tables rings stay driver-free",
    appliesTo: (p) => ringOf(p) === "tables",
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
    appliesTo: (p) => p.startsWith(MODULES),
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
      if (path.startsWith("packages/modules/shared/api/")) return true
      if (path === "packages/modules/shared/tables/Database/Migrations.ts") return true
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

/*
 * Exactly one place may CONSTRUCT a `decision.execute` event.
 *
 * Note what this does and does not assert. Two CALLERS are correct and expected — the human approval path
 * and the auto-approve branch — because them sharing one path is the whole point. What must be unique is the
 * place that builds the event, since a second constructor is how the two paths would silently diverge into
 * "automatic" and "approved" as two features that merely resemble each other.
 *
 * A first version of this check counted callers and failed at 2, which was the check being wrong rather than
 * the code.
 */
const executeEventConstructors = (): Array<string> => {
  const sites: Array<string> = []
  for (const absolute of walk(join(root, "packages"))) {
    const path = relative(root, absolute)
    if (path.includes("/test/")) continue
    const source = readFileSync(absolute, "utf8")
    // The literal that identifies the event being built, not a type annotation mentioning it.
    for (const _ of source.matchAll(/type:\s*"decision\.execute"/g)) sites.push(path)
  }
  return sites
}

/*
 * Every SQL statement touching a tenant table must filter on the organization.
 *
 * This check IS the tenancy guarantee now. Row-level security used to be the second net — a forgotten
 * predicate returned nothing instead of another tenant's rows — and it was removed deliberately (ADR-0014)
 * because better-auth provides the organization but not the isolation, and the role machinery it needed was
 * refused by the managed provider anyway.
 *
 * So the property RLS gave for free is checked here instead. When it was written, **16 statements across 8
 * files had no predicate** and RLS was silently carrying all of them, including reads of `extractions` and
 * `workflow_activities` — both of which hold extracted invoice fields. That is the size of the hole this
 * closes, and the reason it is a hard failure rather than a warning.
 *
 * Writes are satisfied by supplying `organization_id` as a column; reads, updates and deletes need a WHERE.
 */
const TENANT_TABLES = new Set([
  "source_documents",
  "intakes",
  "document_chunks",
  "extractions",
  "decisions",
  "decision_citations",
  "rules",
  "executions",
  "events",
  "workflow_executions",
  "workflow_activities"
])

const unscopedTenantQueries = (): Array<string> => {
  const found: Array<string> = []
  for (const absolute of walk(join(root, "packages"))) {
    const path = relative(root, absolute)
    // Migrations legitimately touch these tables without a tenant: they create them.
    if (path.includes("/test/") || path.includes("/tables/") || path.endsWith("Db.ts")) continue
    const source = readFileSync(absolute, "utf8")

    for (const match of source.matchAll(/sql(?:<[^>]*>)?`([^`]*)`/g)) {
      const body = match[1]!
      const lower = body.toLowerCase()
      const tables = [...body.matchAll(/(?:from|into|update)\s+([a-z_]+)/g)]
        .map((table) => table[1]!)
        .filter((table) => TENANT_TABLES.has(table))
      if (tables.length === 0) continue

      const isInsert = lower.includes("insert into")
      const scoped = isInsert
        ? lower.includes("organization_id") && lower.includes("${orgid}")
        : /organization_id\s*=\s*\$\{orgId\}/.test(body)

      if (!scoped) {
        found.push(`${path}\n      touches ${[...new Set(tables)].join(", ")} without an organization filter`)
      }
    }
  }
  return found
}

for (const unscoped of unscopedTenantQueries()) {
  failures.push(
    `${unscoped}\n    Reads, updates and deletes need \`and organization_id = \${orgId}\`; inserts need the\n` +
      "    column supplied. `Db.scoped` hands you orgId as the second argument — use it. There is no RLS\n" +
      "    behind this any more (ADR-0014)."
  )
}

const emitSites = executeEventConstructors()
if (emitSites.length !== 1) {
  failures.push(
    `a decision.execute event is constructed in ${emitSites.length} place(s), expected exactly 1:\n` +
      emitSites.map((site) => `      ${site}`).join("\n") +
      "\n    Both approval paths must reach execution through ONE emit, or \"the automatic path does\n" +
      "    the same thing\" is an assertion nobody checks."
  )
}

if (failures.length > 0) {
  console.error(`✗ ${failures.length} boundary violation(s):\n`)
  for (const failure of failures) console.error(`  ${failure}\n`)
  process.exit(1)
}

console.log(`✓ boundaries clean (${checked} file-rule checks)`)
