#!/usr/bin/env bun
/**
 * Every `@ea/*` a package imports must be in its own manifest.
 *
 * **Bun hoists workspace packages to the root `node_modules`, so any package can import any other and it
 * resolves locally whatever its manifest says.** Nothing in `preflight` noticed: `tsc` follows the same hoisted
 * paths, `knip` reports dependencies that are declared and unused (the opposite direction), and `syncpack`
 * checks version agreement rather than presence. The gap is only visible to something that resolves strictly —
 * which turned out to be **rolldown, in CI, during the console build**, where `apps/worker` was found importing
 * `@ea/domain` without declaring it.
 *
 * That is the third failure of this exact shape in this repo (AGENTS.md lists the others): a developer machine
 * holds state a fresh one does not. So this is a check rather than a lesson.
 *
 *   bun scripts/workspace-deps.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const root = new URL("..", import.meta.url).pathname

/** Where a workspace package's manifest can be, mirroring `workspaces` in the root package.json. */
const WORKSPACE_GLOBS = ["packages", "packages/integrations", "apps"]
const FLAT_WORKSPACES = ["evals", "scripts", "infra", "e2e"]

const walk = (dir: string): Array<string> => {
  const out: Array<string> = []
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".tsbuildinfo") continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (path.endsWith(".ts") || path.endsWith(".tsx")) out.push(path)
  }
  return out
}

const manifests: Array<{ readonly dir: string; readonly name: string; readonly declared: Set<string> }> = []
for (const group of WORKSPACE_GLOBS) {
  for (const entry of readdirSync(join(root, group))) {
    const dir = join(group, entry)
    try {
      const manifest = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"))
      manifests.push({
        dir,
        name: manifest.name,
        declared: new Set([
          ...Object.keys(manifest.dependencies ?? {}),
          ...Object.keys(manifest.devDependencies ?? {})
        ])
      })
    } catch {
      // A grouping directory with no manifest — `packages/integrations` itself, for instance.
    }
  }
}
for (const dir of FLAT_WORKSPACES) {
  const manifest = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"))
  manifests.push({
    dir,
    name: manifest.name,
    declared: new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {})
    ])
  })
}

const problems: Array<string> = []
let checked = 0

for (const { declared, dir, name } of manifests) {
  const used = new Map<string, string>()
  for (const absolute of walk(join(root, dir))) {
    const source = readFileSync(absolute, "utf8")
    // `@ea/<package>` — the first segment only, since that is what a manifest names.
    for (const match of source.matchAll(/from\s+"(@ea\/[a-z0-9-]+)/g)) {
      const pkg = match[1]!
      if (pkg !== name && !used.has(pkg)) used.set(pkg, relative(root, absolute))
    }
    checked = checked + 1
  }
  for (const [pkg, where] of used) {
    if (!declared.has(pkg)) problems.push(`  ${dir}/package.json does not declare ${pkg}\n    imported by ${where}`)
  }
}

if (problems.length > 0) {
  console.error(`✗ ${problems.length} undeclared workspace dependenc${problems.length === 1 ? "y" : "ies"}:\n`)
  console.error(problems.join("\n"))
  console.error(
    "\n  Bun hoists workspace packages, so this resolves on your machine and fails in a fresh install —\n" +
      "  which is how it reached CI as a rolldown resolution error during the console build."
  )
  process.exit(1)
}

console.log(`✓ every @ea/* import is declared (${manifests.length} packages, ${checked} files)`)
