/**
 * Supplies the Hyperdrive local connection string to the test harness.
 *
 * `wrangler dev` reads apps/worker/.env automatically; `createTestHarness` does not. Reading
 * it here keeps the same source of truth for both, while letting CI provide the variable
 * through the environment instead of a file.
 */
import { existsSync, readFileSync } from "node:fs"

const VAR = "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE"

if (process.env[VAR] === undefined || process.env[VAR] === "") {
  const envFile = new URL("../.env", import.meta.url).pathname
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (match?.[1] === VAR) {
        process.env[VAR] = match[2]!.replace(/^["']|["']$/g, "")
      }
    }
  }
}

if (process.env[VAR] === undefined || process.env[VAR] === "") {
  throw new Error(
    `${VAR} is not set.\n` +
      "Run `docker compose up -d`, then copy apps/worker/.env.example to apps/worker/.env " +
      "and fill in the connection string (see compose.yaml for the values)."
  )
}
