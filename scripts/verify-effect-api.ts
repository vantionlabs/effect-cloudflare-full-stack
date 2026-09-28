#!/usr/bin/env bun
/**
 * Regenerates docs/effect-v4-api-notes.md from the INSTALLED effect package.
 *
 * This exists because the subpath names moved within the v4 RC series: rc.109 and
 * rc.117 expose `effect/unstable/http` and `effect/unstable/httpapi`, while rc.118's
 * export map has no `unstable/` prefix at all. Guessing wrong touches every import in
 * the repo, so the table is generated, never written by hand.
 *
 * Run after every effect bump. `bun run effect:verify`
 */
import { readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

const INTERESTING = [
  "ai",
  "http",
  "http-api",
  "httpapi",
  "rpc",
  "sql",
  "schema",
  "workflow",
  "cluster",
  "persistence",
  "observability",
  "socket",
  "net"
] as const

const pkg = JSON.parse(
  readFileSync(require.resolve("effect/package.json"), "utf8")
) as { version: string; exports: Record<string, unknown> }

const paths = Object.keys(pkg.exports).toSorted()
const hasUnstable = paths.some((p) => p.includes("unstable"))

/** Where each module actually lives at this version. */
const resolved = INTERESTING.map((name) => {
  const direct = `./${name}`
  const unstable = `./unstable/${name}`
  const wildcard = hasUnstable ? `effect/unstable/${name}` : `effect/${name}`
  const specifier = paths.includes(direct)
    ? `effect/${name}`
    : paths.includes(unstable)
    ? `effect/unstable/${name}`
    : `${wildcard}  (via wildcard — verify by import)`
  return { name, specifier, explicit: paths.includes(direct) || paths.includes(unstable) }
})

const table = resolved
  .map((r) => `| \`${r.name}\` | \`${r.specifier}\` | ${r.explicit ? "explicit" : "wildcard"} |`)
  .join("\n")

const body = `# Effect v4 API notes — GENERATED, do not edit

Regenerate with \`bun run effect:verify\` after every effect bump.

- **Installed version:** \`${pkg.version}\`
- **\`unstable/\` prefix present:** ${hasUnstable ? "**yes**" : "no"}
- Generated: ${new Date().toISOString().slice(0, 10)}

## Module specifiers to import from

| Module | Import specifier | Source |
| --- | --- | --- |
${table}

## Full export map (${paths.length} paths)

${paths.map((p) => `- \`${p}\``).join("\n")}
`

writeFileSync(new URL("../docs/effect-v4-api-notes.md", import.meta.url), body)

console.log(`effect ${pkg.version} — unstable prefix: ${hasUnstable ? "YES" : "no"}`)
for (const r of resolved) console.log(`  ${r.name.padEnd(14)} ${r.specifier}`)
console.log("\nwrote docs/effect-v4-api-notes.md")
