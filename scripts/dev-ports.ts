#!/usr/bin/env bun
/**
 * Where the local services live, and whether each port is free — printed before `bun run dev` starts anything.
 *
 *   bun run ports            # print the table
 *   bun scripts/dev-ports.ts --require console,worker   # also exit 1 if one of those ports is taken
 *
 * Exists because a taken :5173 was invisible: Vite either moved the console to :5174 (where sign-in breaks — BASE_URL
 * and ALLOWED_HOSTS name :5173) or, with `--strictPort`, exited with "Port 5173 is already in use" and nothing about
 * WHAT holds it. Usually it is another project's dev server, so this names the process instead of guessing.
 */
import { spawnSync } from "node:child_process"

const SERVICES = [
  { key: "console", name: "Console (+ API behind it)", port: 5173, url: "http://localhost:5173" },
  { key: "worker", name: "API Worker alone (dev:worker)", port: 8787, url: "http://localhost:8787" },
  // Listening is the GOOD state for the database (`bun run db:up` started it); for the servers it means "taken".
  { key: "postgres", name: "Postgres (compose)", port: 55433, url: "localhost:55433", database: true }
] as const

/**
 * Whether anything listens on the port, on ANY address. Asked of lsof rather than tested by binding: a test bind on
 * `localhost` succeeded beside Docker's `*:55433` and another Vite on `[::1]:5173`, and reported both as free.
 */
const listeners = (port: number): Array<string> =>
  spawnSync("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).stdout.trim().split("\n")
    .filter(Boolean)

/** The process listening on a port, from lsof — empty when lsof is missing or says nothing. */
const holder = (port: number): string => {
  const pid = listeners(port)[0]
  if (pid === undefined) return ""
  const command = spawnSync("ps", ["-o", "command=", "-p", pid], { encoding: "utf8" }).stdout.trim()
  return `pid ${pid}: ${command.length > 110 ? `${command.slice(0, 107)}…` : command}`
}

const required = new Set(
  (process.argv.find((arg) => arg.startsWith("--require="))?.slice("--require=".length)
    ?? (process.argv.includes("--require") ? process.argv[process.argv.indexOf("--require") + 1] : undefined)
    ?? "").split(",").filter(Boolean)
)

let blocked = false
console.log("\n  effect-ai local services\n")
for (const service of SERVICES) {
  const free = listeners(service.port).length === 0
  if ("database" in service) {
    console.log(
      `  ${service.name.padEnd(32)} ${service.url.padEnd(24)} ${free ? "not running — bun run db:up" : "running"}`
    )
    continue
  }
  console.log(`  ${service.name.padEnd(32)} ${service.url.padEnd(24)} ${free ? "free" : "IN USE"}`)
  if (!free) {
    const who = holder(service.port)
    if (who !== "") console.log(`  ${"".padEnd(32)} ↳ ${who}`)
    if (required.has(service.key)) blocked = true
  }
}
console.log("")
if (blocked) {
  console.error(
    "  A port this command needs is taken. Stop the process above (or that project's dev server) and retry.\n"
  )
  process.exit(1)
}
