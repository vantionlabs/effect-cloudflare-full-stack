#!/usr/bin/env bun
/**
 * Audits every `effect/*` import in a dependency against the INSTALLED effect version,
 * and reports which specifiers no longer resolve.
 *
 * Why this exists: bridging a dependency across Effect v4 RCs is not a single mechanical
 * rename. Between rc.117 and rc.118 the `unstable/` prefix was dropped AND several
 * top-level modules moved into subdirectories (`effect/Encoding` -> `effect/encoding/...`).
 * Discovering that one failed import at a time is slow and leaves a half-working patch, so
 * this enumerates the whole surface before writing one.
 *
 *   bun scripts/audit-effect-imports.ts node_modules/alchemy
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const target = process.argv[2]
if (target === undefined) {
  console.error("usage: bun scripts/audit-effect-imports.ts <package-dir>")
  process.exit(1)
}

const walk = (dir: string): Array<string> => {
  const out: Array<string> = []
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) out.push(...walk(path))
    else if (/\.(ts|tsx|js|mjs)$/.test(entry)) out.push(path)
  }
  return out
}

const specifiers = new Map<string, Set<string>>()
const pattern = /from\s+"(effect\/[^"]+)"|import\("(effect\/[^"]+)"\)/g

for (const file of walk(join(target, "src"))) {
  const source = readFileSync(file, "utf8")
  for (const match of source.matchAll(pattern)) {
    const spec = match[1] ?? match[2]
    if (spec === undefined) continue
    const seen = specifiers.get(spec) ?? new Set()
    seen.add(file)
    specifiers.set(spec, seen)
  }
}

const broken: Array<{ spec: string; count: number }> = []
for (const [spec, files] of specifiers) {
  try {
    await import(spec)
  } catch {
    broken.push({ spec, count: files.size })
  }
}

broken.sort((a, b) => b.count - a.count || a.spec.localeCompare(b.spec))

console.log(`${specifiers.size} distinct effect specifiers, ${broken.length} unresolvable\n`)
for (const { spec, count } of broken) {
  console.log(`  ${String(count).padStart(4)} files  ${spec}`)
}
